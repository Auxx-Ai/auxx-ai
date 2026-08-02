// packages/lib/src/mail-filters/retroactive.ts
// Phase 3 "Reach" (plan §7): the preview count, the paged retroactive apply job
// and the post-connect prompt (D18).
//
// ⚠️ INVARIANT 5 — ONE EVALUATOR, FOREVER. Nothing in this file matches mail on
// its own. The preview and the backfill both compile their predicate through
// `buildFilterPredicate` (→ `condition-query-builder`), exactly like the fire
// path, which is the whole dividend of dropping the in-memory tier (§4.2). A
// "just this one field" fast path here would reintroduce the divergence the
// design removed — add the field to the builder instead.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { ConditionGroup } from '../conditions/types'
import { BadRequestError, NotFoundError } from '../errors'
import type { JobContext } from '../jobs/types'
import { type MailViewer, SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import { getProviderCapabilities } from '../providers/provider-capabilities'
import type { ChannelProviderType } from '../providers/types'
import { isRetroactiveSkippedAction, RETROACTIVE_SKIPPED_ACTION_TYPES } from './actions'
import { buildFilterPredicate } from './evaluate'
import { getMailFilterById } from './queries'
import type { CachedMailFilter, MailFilterAction, MailFilterRow } from './types'

const logger = createScopedLogger('mail-filters-retroactive')

/**
 * Default ceiling for {@link previewMatchCount}.
 *
 * A body predicate over a large mailbox is a slow count, and the dialog renders
 * `500+` past the cap rather than an exact number (§6.5) — so the query is
 * bounded work by construction and the mailbox is never counted whole.
 */
export const PREVIEW_MATCH_COUNT_CAP = 500

/** Threads fetched per backfill page (invariant 10 — page it, never slurp). */
export const RETROACTIVE_PAGE_SIZE = 200

/**
 * Hard ceiling on threads one backfill may touch — "bounded blast radius"
 * (invariant 10). Hitting it terminates the job with a logged reason; it is
 * never a silent truncate.
 */
export const RETROACTIVE_MAX_THREADS = 5000

/** BullMQ job name. Registered on `maintenanceQueue` (`maintenance-worker.ts`). */
export const MAIL_FILTER_RETROACTIVE_JOB_NAME = 'mailFilterRetroactiveApplyJob'

// ─────────────────────────────────────────────────────────────────────────────
// 1. Preview count (§7, §6.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewMatchCountResult {
  /** Matching threads, clamped to the cap. */
  count: number
  /** True when there were MORE matches than the cap — render `<cap>+`. */
  capped: boolean
  /**
   * Always `true`: the preview is a **lower bound** on what will fire, never an
   * upper one. See {@link previewMatchCount} — the UI must word the count as
   * "at least", not as an exact promise.
   */
  lowerBound: true
}

/**
 * How many EXISTING threads in `inboxId` these conditions match, bounded.
 *
 * The identical compilation the fire path uses — {@link buildFilterPredicate},
 * i.e. `condition-query-builder` — with exactly one deliberate difference:
 *
 * ⚠️ **Preview and fire time evaluate under DIFFERENT PRINCIPALS.** This runs as
 * the requesting user (a preview must not count threads the author cannot see);
 * the engine runs as `SYSTEM_VISIBILITY` and is bounded by containment (§4.4)
 * instead. For a shared inbox the author holds `edit` on — the §5.1 requirement
 * — the two agree, since `edit` outranks the `read` that body/subject scopes
 * need. They can still diverge on record-derived grants (a thread whose primary
 * entity the author holds no grant on is invisible here but perfectly visible to
 * the engine), so **the preview is a lower bound on what will fire**. That is
 * the safe direction, and {@link PreviewMatchCountResult.lowerBound} is the flag
 * the dialog copy hangs off — never imply an exact count.
 *
 * Two bounds, both load-bearing:
 *  - **`inboxId`** — the containment boundary (§4.4). A preview that counted the
 *    whole org would promise reach the filter does not have.
 *  - **`LIMIT cap + 1` inside a subquery** — so a body predicate over a large
 *    mailbox is bounded work. The `+ 1` is what distinguishes "exactly the cap"
 *    from "more than the cap" without a second query.
 *
 * The predicate stays in the WHERE position (invariant 6): a Drizzle `Column` in
 * a single-table projection loses its table qualifier, and the correlated
 * `exists(...)` subqueries `buildToQuery` / `buildHasAttachmentsQuery` emit would
 * silently self-join and fail closed.
 */
export async function previewMatchCount(
  db: Database,
  organizationId: string,
  inboxId: string,
  conditions: ConditionGroup[],
  viewer: MailViewer,
  opts: { cap?: number } = {}
): Promise<PreviewMatchCountResult> {
  const cap = Math.max(1, Math.trunc(opts.cap ?? PREVIEW_MATCH_COUNT_CAP))
  const predicate = buildFilterPredicate({ conditions }, organizationId, viewer)

  const result = await db.execute(sql`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM ${schema.Thread}
      WHERE ${and(eq(schema.Thread.inboxId, inboxId), predicate)}
      LIMIT ${cap + 1}
    ) AS bounded
  `)

  const raw = Number((result.rows?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const capped = raw > cap
  return { count: capped ? cap : raw, capped, lowerBound: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Retroactive apply (§7, invariant 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface MailFilterRetroactiveJobData {
  organizationId: string
  filterId: string
  /** For the log trail only — the backfill still executes as SYSTEM. */
  requestedByUserId?: string
  /** Test/ops override for {@link RETROACTIVE_MAX_THREADS}. */
  maxThreads?: number
  /** Test/ops override for {@link RETROACTIVE_PAGE_SIZE}. */
  pageSize?: number
}

/** Why the backfill stopped — always logged, never silent (invariant 10). */
export type RetroactiveTermination =
  /** Every matching thread was covered. */
  | 'complete'
  /** {@link RETROACTIVE_MAX_THREADS} reached — more threads still match. */
  | 'max-threads'
  /** The BullMQ job was cancelled mid-run. */
  | 'cancelled'

export interface RetroactiveApplyReport {
  filterId: string
  inboxId: string
  /** Threads read from the paged selection. */
  covered: number
  /** Threads the engine actually fired on (a claim may already be held). */
  fired: number
  /** Threads skipped because they carry no message to key the claim on. */
  skippedNoMessage: number
  /**
   * `run-agent` / `run-workflow` actions the backfill refused to run (D18 — see
   * {@link RETROACTIVE_SKIPPED_ACTION_TYPES}). Counted per executed action, not
   * per thread, and surfaced on the summary log line: a skip nobody can see is
   * the silent truncate invariant 10 forbids.
   */
  skippedEscapeHatchActions: number
  pages: number
  pageSize: number
  termination: RetroactiveTermination
}

/**
 * Enqueue the backfill for one filter.
 *
 * `jobId` deduplicates a double-click into one run while the job is in flight;
 * `removeOnComplete` means a later, deliberate re-apply still gets through (and
 * is harmless anyway — the `(filterId, messageId, 'retroactive')` claim makes a
 * second pass over the same threads a no-op).
 */
export async function applyRetroactively(input: {
  organizationId: string
  filterId: string
  requestedByUserId?: string
}): Promise<void> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  await getQueue(Queues.maintenanceQueue).add(
    MAIL_FILTER_RETROACTIVE_JOB_NAME,
    {
      organizationId: input.organizationId,
      filterId: input.filterId,
      requestedByUserId: input.requestedByUserId,
    } satisfies MailFilterRetroactiveJobData,
    {
      jobId: `mail-filter-retroactive:${input.organizationId}:${input.filterId}`,
      removeOnComplete: true,
      removeOnFail: true,
    }
  )
}

/** The cache shape the engine wants, from a persisted row. */
function toCachedFilter(row: MailFilterRow): CachedMailFilter {
  return {
    id: row.id,
    inboxId: row.inboxId,
    name: row.name,
    order: row.order,
    stopProcessing: row.stopProcessing,
    enabled: row.enabled,
    conditions: row.conditions,
    actions: row.actions,
    templateKey: row.templateKey,
  }
}

/**
 * Page through the threads one filter matches and run **the same action
 * executor** the live gate runs, one `MailFilterRun` per thread — so the same
 * undo and the same audit trail apply (§7).
 *
 * Four properties this job exists to hold:
 *
 * 1. **`source: 'retroactive'` on every row.** The claim key is
 *    `(filterId, messageId, source)`, and a per-thread retroactive row has to
 *    borrow the thread's LATEST message id — which is exactly why `source` is in
 *    the key. Without the discriminator the backfill would collide with an
 *    existing live run and `ON CONFLICT DO NOTHING` would silently discard the
 *    retroactive outcome **and its undo blob**.
 * 2. **The engine's claim → execute → complete protocol, unmodified.** This
 *    calls {@link import('./engine').fireMailFilters}; it does not reimplement
 *    it. The claim is what makes a job retry safe.
 * 3. **Containment (§4.4) unchanged** — only threads whose `inboxId` equals the
 *    filter's are selected, and the engine re-asserts it per thread anyway.
 * 4. **Bounded and logged** (invariant 10): keyset paging, a hard thread
 *    ceiling, and a termination reason on the summary log line. Never a silent
 *    truncate.
 * 5. **No agents, no workflows** (D18). The executor refuses
 *    {@link RETROACTIVE_SKIPPED_ACTION_TYPES} on a `retroactive` run — a backfill
 *    is paged, logged and undoable, and an agent replying to a months-old
 *    customer thread is none of those. Each refusal is a `skipped` outcome with a
 *    reason on its run row, and they are counted into
 *    {@link RetroactiveApplyReport.skippedEscapeHatchActions} for the summary
 *    line, so a filter that "did nothing visible" explains itself.
 *
 * Paging is **keyset on `Thread.id`**, not `OFFSET`. The actions mutate the very
 * columns the predicate reads (a `set-status` filter archives the threads it
 * selects), so an offset window would slide underneath itself and skip rows; an
 * ascending id cursor cannot.
 *
 * `fireMailFilters` re-evaluates the filter against each thread — one confirm
 * round trip per thread. That is deliberate: it keeps ONE evaluator (invariant
 * 5) and re-checks the match against the live row after the previous page's
 * mutations. The thread ceiling is what bounds the cost.
 */
export async function mailFilterRetroactiveApplyJob(
  ctx: JobContext<MailFilterRetroactiveJobData>
): Promise<RetroactiveApplyReport | { skipped: string }> {
  const { database } = await import('@auxx/database')
  const { organizationId, filterId, requestedByUserId } = ctx.data
  const pageSize = Math.max(1, Math.trunc(ctx.data.pageSize ?? RETROACTIVE_PAGE_SIZE))
  const maxThreads = Math.max(1, Math.trunc(ctx.data.maxThreads ?? RETROACTIVE_MAX_THREADS))

  const filterResult = await getMailFilterById(database, organizationId, filterId)
  if (filterResult.isErr()) {
    logger.warn('Retroactive apply skipped — filter not found', { organizationId, filterId })
    return { skipped: 'filter-not-found' }
  }
  const row = filterResult.value
  if (!row.enabled) {
    // A disabled filter is OFF. A backfill is the largest mutation this feature
    // performs, so it never runs for a rule the org has switched off.
    logger.warn('Retroactive apply skipped — filter is disabled', { organizationId, filterId })
    return { skipped: 'filter-disabled' }
  }

  const filter = toCachedFilter(row)
  const { getOrgCache } = await import('../cache')
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const inboxRow = inboxes.find((inbox) => inbox.id === filter.inboxId)
  const inbox = inboxRow
    ? {
        id: inboxRow.id,
        // The DERIVED marker, matching `apply-mail-filters.ts` — a def-only read
        // treats an unmigrated personal mailbox as shared.
        isPersonal: inboxRow.isPersonal,
        ownerUserId: inboxRow.ownerUserId,
      }
    : null

  const { fireMailFilters } = await import('./engine')
  const predicate = buildFilterPredicate(filter, organizationId, SYSTEM_VISIBILITY)

  // How many actions this filter carries that the executor will refuse on a
  // `retroactive` run (D18). Fixed for the whole job — the filter row is read
  // once — so the count is derived rather than plumbed back out of the engine.
  const escapeHatchActionCount = filter.actions.filter((action) =>
    isRetroactiveSkippedAction(action.type)
  ).length

  const report: RetroactiveApplyReport = {
    filterId,
    inboxId: filter.inboxId,
    covered: 0,
    fired: 0,
    skippedNoMessage: 0,
    skippedEscapeHatchActions: 0,
    pages: 0,
    pageSize,
    termination: 'complete',
  }

  let cursor: string | null = null
  while (report.covered < maxThreads) {
    const threads = await database
      .select({
        id: schema.Thread.id,
        inboxId: schema.Thread.inboxId,
        status: schema.Thread.status,
        assigneeId: schema.Thread.assigneeId,
        latestMessageId: schema.Thread.latestMessageId,
      })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.inboxId, filter.inboxId),
          predicate,
          ...(cursor ? [gt(schema.Thread.id, cursor)] : [])
        )
      )
      .orderBy(asc(schema.Thread.id))
      .limit(Math.min(pageSize, maxThreads - report.covered))

    if (threads.length === 0) break
    report.pages += 1
    cursor = threads[threads.length - 1]?.id ?? cursor

    for (const thread of threads) {
      if (ctx.isCancelled()) {
        report.termination = 'cancelled'
        break
      }
      report.covered += 1

      // A run row needs a `messageId` for the claim key. A thread with no
      // message cannot be claimed, so it is skipped and COUNTED — silence here
      // would look like the filter simply did not match.
      if (!thread.latestMessageId) {
        report.skippedNoMessage += 1
        continue
      }

      const result = await fireMailFilters({
        db: database,
        organizationId,
        threadId: thread.id,
        messageId: thread.latestMessageId,
        thread: {
          inboxId: thread.inboxId,
          status: thread.status ?? null,
          assigneeId: thread.assigneeId ?? null,
        },
        inbox,
        filters: [filter],
        source: 'retroactive',
      })
      if (result.firedFilterIds.length > 0) {
        report.fired += 1
        // The filter executed, so every escape-hatch action on it was skipped
        // with `RETROACTIVE_SKIP_REASON` on that thread's run row.
        report.skippedEscapeHatchActions += escapeHatchActionCount
      }
    }

    if (report.termination === 'cancelled') break
    if (threads.length < pageSize) break
  }

  if (report.termination === 'complete' && report.covered >= maxThreads) {
    report.termination = 'max-threads'
  }

  const summary = { organizationId, requestedByUserId, ...report, maxThreads }
  if (report.termination === 'complete') {
    logger.info('Retroactive mail-filter apply finished', summary)
  } else {
    // Early termination is never silent (invariant 10) — the reason is the point.
    logger.warn('Retroactive mail-filter apply terminated early', summary)
  }

  return report
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The post-connect prompt (§7, D18)
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingRetroactivePrompt {
  inboxId: string
  /** Enabled filters on that inbox — the "N" in "Apply your N filters". */
  filterCount: number
  /** Existing conversations in that inbox — the "M", clamped to the cap. */
  threadCount: number
  /** True when the mailbox holds MORE threads than the cap — render `M+`. */
  threadCountCapped: boolean
}

/** Ceiling for the prompt's thread count — the copy says `1000+` past it. */
export const PROMPT_THREAD_COUNT_CAP = 1000

/**
 * The one inbox worth prompting about, or `null`.
 *
 * A freshly connected mailbox backfills with filters OFF: `message:received` is
 * published only when `messageData.isInbound && !ctx.isInitialSync`
 * (`ingest/store-message.ts`). That is the safe default (D18) — nothing
 * mass-mutates a mailbox we just met — but it leaves the owner staring at an
 * unfiltered inbox, so once the backfill is done we ASK.
 *
 * ⚠️ **Never automatic.** This function only decides whether the question is
 * worth asking; the mutation still needs a click, which lands on
 * {@link applyRetroactively} — the same paged, logged, undoable path.
 *
 * `candidateInboxIds` is the caller's already-authorized set (the router hands
 * down `MailFilterAuthority.inboxIds` minus the ones this user dismissed), so
 * this holds no permission logic of its own — the house rule.
 *
 * The four conditions, cheapest first:
 *  1. the inbox has ≥ 1 **enabled** filter;
 *  2. none of those filters has ever produced a `retroactive` run — one apply
 *     answers the question permanently, without needing a dismissal write;
 *  3. a live channel on that inbox has **finished** a sync at least once
 *     (`lastSuccessfulSync IS NOT NULL` and it is not mid-sync) and its provider
 *     is filter-capable (D17 / invariant 17 — `PROVIDER_CAPABILITIES`, never a
 *     hardcoded provider list);
 *  4. the mailbox actually holds threads.
 */
export async function findPendingRetroactivePrompt(
  db: Database,
  organizationId: string,
  candidateInboxIds: string[],
  opts: { threadCountCap?: number } = {}
): Promise<PendingRetroactivePrompt | null> {
  if (candidateInboxIds.length === 0) return null
  const candidates = new Set(candidateInboxIds)
  const cap = Math.max(1, Math.trunc(opts.threadCountCap ?? PROMPT_THREAD_COUNT_CAP))

  const filters = await db
    .select({ id: schema.MailFilter.id, inboxId: schema.MailFilter.inboxId })
    .from(schema.MailFilter)
    .where(
      and(eq(schema.MailFilter.organizationId, organizationId), eq(schema.MailFilter.enabled, true))
    )

  const byInbox = new Map<string, string[]>()
  for (const filter of filters) {
    if (!candidates.has(filter.inboxId)) continue
    byInbox.set(filter.inboxId, [...(byInbox.get(filter.inboxId) ?? []), filter.id])
  }
  if (byInbox.size === 0) return null

  // Already answered: an inbox whose filters have run retroactively even once
  // never asks again. Cheaper and more honest than a dismissal flag, which
  // would still be set on an inbox the user actually applied.
  const candidateFilterIds = [...byInbox.values()].flat()
  const applied = await db
    .selectDistinct({ filterId: schema.MailFilterRun.filterId })
    .from(schema.MailFilterRun)
    .where(
      and(
        eq(schema.MailFilterRun.organizationId, organizationId),
        eq(schema.MailFilterRun.source, 'retroactive'),
        inArray(schema.MailFilterRun.filterId, candidateFilterIds)
      )
    )
  const appliedFilterIds = new Set(applied.map((row) => row.filterId))
  for (const [inboxId, filterIds] of byInbox) {
    if (filterIds.some((id) => appliedFilterIds.has(id))) byInbox.delete(inboxId)
  }
  if (byInbox.size === 0) return null

  // Initial backfill finished, on a filter-capable provider.
  const channels = await db
    .select({
      inboxId: schema.InboxIntegration.inboxId,
      provider: schema.Integration.provider,
    })
    .from(schema.InboxIntegration)
    .innerJoin(schema.Integration, eq(schema.Integration.id, schema.InboxIntegration.integrationId))
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        isNull(schema.Integration.deletedAt),
        eq(schema.Integration.enabled, true),
        isNotNull(schema.Integration.lastSuccessfulSync),
        ne(schema.Integration.syncStatus, 'SYNCING')
      )
    )

  const synced = new Set(
    channels
      .filter((c) => getProviderCapabilities(c.provider as ChannelProviderType).supportsMailFilters)
      .map((c) => c.inboxId)
  )

  // `candidateInboxIds` order is the caller's order (the authority's inbox
  // order), so the prompt is stable across refetches rather than whatever the
  // filter query happened to return first.
  for (const inboxId of candidateInboxIds) {
    const filterIds = byInbox.get(inboxId)
    if (!filterIds || !synced.has(inboxId)) continue

    const counted = await db.execute(sql`
      SELECT count(*)::int AS count FROM (
        SELECT 1 FROM ${schema.Thread}
        WHERE ${and(
          eq(schema.Thread.organizationId, organizationId),
          eq(schema.Thread.inboxId, inboxId),
          isNull(schema.Thread.mergedIntoThreadId)
        )}
        LIMIT ${cap + 1}
      ) AS bounded
    `)
    const raw = Number((counted.rows?.[0] as { count?: number | string } | undefined)?.count ?? 0)
    if (raw === 0) continue

    return {
      inboxId,
      filterCount: filterIds.length,
      threadCount: raw > cap ? cap : raw,
      threadCountCapped: raw > cap,
    }
  }

  return null
}

/**
 * Guard the router's `applyRetroactively` call: a filter must exist, be enabled,
 * and carry at least one action that actually does something to an EXISTING
 * conversation.
 *
 * Three action types do not qualify: `suppress-automations` (it only shapes the
 * live event fan-out) and the two escape hatches, which the executor refuses on a
 * retroactive run (D18 — {@link RETROACTIVE_SKIPPED_ACTION_TYPES}). A filter made
 * only of those would page the whole mailbox and write run rows whose every
 * outcome is `skipped`, which is worse than a clear refusal up front.
 *
 * Kept beside the job so "what makes a filter backfillable" is stated once. The
 * job re-checks existence and `enabled` independently — a filter can be disabled
 * between the click and the worker picking the job up.
 */
export function assertBackfillable(row: MailFilterRow): Result<MailFilterRow, Error> {
  if (!row.enabled) {
    return err(
      new BadRequestError('Enable this filter before applying it to existing conversations.')
    )
  }
  const actionable = row.actions.some(
    (action: MailFilterAction) =>
      action.type !== 'suppress-automations' && !isRetroactiveSkippedAction(action.type)
  )
  if (!actionable) {
    return err(
      new BadRequestError(
        'This filter has nothing to apply to existing conversations — suppressing automations, running an agent and running a workflow all only affect new mail.'
      )
    )
  }
  return ok(row)
}

/** Load + guard in one step — the router's whole precondition for a backfill. */
export async function loadBackfillableFilter(
  db: Database,
  organizationId: string,
  filterId: string
): Promise<Result<MailFilterRow, Error>> {
  const result = await getMailFilterById(db, organizationId, filterId)
  if (result.isErr()) return err(result.error ?? new NotFoundError('Filter not found'))
  return assertBackfillable(result.value)
}
