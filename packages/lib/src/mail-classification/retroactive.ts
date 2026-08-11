// packages/lib/src/mail-classification/retroactive.ts
// Retroactive re-classification — PHASE 1 (07-mail-reclassification-plan.md §4):
// scope resolution (§2.4), the shared count (§2.5), one-inference-per-thread
// selection (§2.3) and SAMPLE MODE (§2.11).
//
// Shape copied from `mail-filters/retroactive.ts:174` — the proven precedent for
// exactly this: a queue job with a deterministic `jobId`, paged and logged.
//
// ─── The four things a reader will otherwise get wrong ───────────────────────
//
// ⚠️ 1. THE UNIT IS THE THREAD, NEVER THE MESSAGE (R3, §2.3, invariant 2).
//    Live classification is per-message and that is correct — one message
//    arrives, one inference, and guard exit 6 stops the next message on that
//    thread. A retroactive run has no such natural throttle: pointed at a backlog
//    it would see every message individually, so a 20-message thread would cost
//    20 inferences to produce one tag. Across the measured corpus that is 9,441
//    inferences to categorise 7,509 threads. So: select THREADS, classify the
//    FIRST INBOUND message of each, apply at most one tag.
//
// ⚠️ 2. THIS PATH MUST NOT RE-RUN MAIL FILTERS (R2, §2.12, invariant 3).
//    `rerunMailFiltersAfterClassification` is MANDATORY on the live path
//    (`05-mail-classification-plan.md` invariant 15) — and this is the deliberate
//    exception. Firing `assign` / `archive` / `run-agent` over a historical
//    backlog is the late-filter-action problem; a retroactive run tags and stops.
//    Do not "fix" the inconsistency. A user who wants filters applied to the
//    newly-tagged backlog runs `mail-filters/retroactive.ts` themselves — a
//    separate, already-paged, already-undoable action.
//    This file therefore never imports that module. That absence is the feature.
//
// ⚠️ 3. `machineMailTier IS NULL` MEANS *NOT EVALUATED*, NOT *HUMAN*
//    (invariant 4). Detection only went live 2026-07-15, so the column is NULL on
//    ~84% of the corpus. The predicate is `IS DISTINCT FROM 'hard'`. A
//    `tier IS NULL` predicate silently excludes almost every thread worth
//    classifying, and looks like "nothing to do" rather than like a bug.
//
// ⚠️ 4. THE EXIT-5 BYPASS IS A JOB PARAMETER, NEVER A GUARD CHANGE (§2.6,
//    invariant 5). `guardClassification`'s default stays "classify once, ever".
//    Only the two "already done" exits are bypassable, and only in `re-classify`
//    mode; the opt-in exits are never bypassable (invariant 6 — a re-run is a way
//    to catch up, not a way in).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import type { JobContext } from '../jobs/types/job-context'
import { applyClassificationTag, markMessageClassified } from './apply'
import { classifyMessage } from './classify'
import {
  MAIL_CLASSIFICATION_INBOX_IDS_SETTING,
  MAIL_CLASSIFICATION_METADATA_KEY,
  MAIL_RECLASSIFY_APPLY_JOB_NAME,
  MAIL_RECLASSIFY_BACKLOG_COUNT_CAP,
  MAIL_RECLASSIFY_MAX_THREADS,
  MAIL_RECLASSIFY_PAGE_SIZE,
  MAIL_RECLASSIFY_SAMPLE_JOB_NAME,
  MAIL_RECLASSIFY_SAMPLE_SIZE,
  type MailClassificationLabel,
  type MailClassificationSkipReason,
  type MailReclassifyMode,
  type MailReclassifyRange,
  type MailReclassifyRunReport,
  type MailReclassifyRunStatus,
  type MailReclassifySampleReport,
  type MailReclassifySampleStatus,
  type MailReclassifyUndoReport,
} from './client'
import { guardClassification } from './guard'
import { getEligibleClassificationTags } from './labels'
import type { MailClassificationContext } from './types'

const logger = createScopedLogger('mail-reclassification')

/**
 * Delay between inferences inside one run (§2.5 — "throttled").
 *
 * This is the one path that deliberately generates sustained model load, and
 * with the circuit breaker inert (`05-…§12.6`) there is nothing else shedding
 * it. Threads are processed strictly sequentially (concurrency 1) and this delay
 * sits between them, so the ceiling is roughly one inference per
 * `(call duration + delay)`.
 */
export const MAIL_RECLASSIFY_THREAD_DELAY_MS = 250

/**
 * The two guard exits a `re-classify` run may bypass (§2.6).
 *
 * ⚠️ Deliberately an explicit pair, not "any skip reason". `'machine-mail'`,
 * `'no-thread'`, `'inbox-not-opted-in'` and `'no-eligible-tags'` stay fatal in
 * BOTH modes — invariant 6: a re-run cannot be used to bypass the opt-in.
 */
const BYPASSABLE_EXITS = new Set<MailClassificationSkipReason>([
  'already-classified',
  'thread-already-categorised',
])

// ─────────────────────────────────────────────────────────────────────────────
// 1. Scope resolution (§2.4)
// ─────────────────────────────────────────────────────────────────────────────

/** A range resolved against a clock — the only place presets become bounds. */
export interface ResolvedReclassifyWindow {
  /** Inclusive lower bound on `Thread.lastMessageAt`, or null for all time. */
  since: Date | null
  /** Exclusive upper bound on `Thread.lastMessageAt`, or null for "up to now". */
  until: Date | null
  /** Threads this range permits, already intersected with the hard cap. */
  maxThreads: number
  /** Which of the two produced `maxThreads` — the UI words the confirm on it. */
  limitSource: 'range' | 'cap'
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Turn a {@link MailReclassifyRange} into date bounds and a thread ceiling.
 *
 * Pure — the clock is injected — because this is the piece worth pinning in
 * tests, and because the count preview and the job must resolve the SAME window
 * from the same input (invariant 10).
 *
 * Note the two range families bound different things: `'days'` / `'custom'` /
 * `'all-time'` bound the *dates* and are capped at
 * {@link MAIL_RECLASSIFY_MAX_THREADS}, while `'threads'` bounds the *count* and
 * leans entirely on the newest-first ordering (invariant 8) to mean "the N most
 * recent".
 */
export function resolveReclassifyWindow(
  range: MailReclassifyRange,
  opts: { now?: Date; hardCap?: number } = {}
): Result<ResolvedReclassifyWindow, Error> {
  const now = opts.now ?? new Date()
  const hardCap = Math.max(1, Math.trunc(opts.hardCap ?? MAIL_RECLASSIFY_MAX_THREADS))

  switch (range.kind) {
    case 'days': {
      const days = Math.trunc(range.days)
      if (!Number.isFinite(days) || days <= 0) {
        return err(new BadRequestError('A day range must be a positive number of days.'))
      }
      return ok({
        since: new Date(now.getTime() - days * DAY_MS),
        until: null,
        maxThreads: hardCap,
        limitSource: 'cap',
      })
    }
    case 'threads': {
      const threads = Math.trunc(range.threads)
      if (!Number.isFinite(threads) || threads <= 0) {
        return err(new BadRequestError('A thread range must be a positive number of threads.'))
      }
      return ok({
        since: null,
        until: null,
        maxThreads: Math.min(threads, hardCap),
        limitSource: threads <= hardCap ? 'range' : 'cap',
      })
    }
    case 'custom': {
      const since = new Date(range.sinceIso)
      if (Number.isNaN(since.getTime())) {
        return err(new BadRequestError('The start of a custom range is not a valid date.'))
      }
      let until: Date | null = null
      if (range.untilIso) {
        until = new Date(range.untilIso)
        if (Number.isNaN(until.getTime())) {
          return err(new BadRequestError('The end of a custom range is not a valid date.'))
        }
        if (until.getTime() <= since.getTime()) {
          return err(new BadRequestError('A custom range must end after it starts.'))
        }
      }
      return ok({ since, until, maxThreads: hardCap, limitSource: 'cap' })
    }
    case 'all-time':
      return ok({ since: null, until: null, maxThreads: hardCap, limitSource: 'cap' })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The ONE predicate (§2.5, invariant 10)
// ─────────────────────────────────────────────────────────────────────────────

/** Keyset position, newest-first. `at` is the raw `timestamp` text from PG. */
export interface ReclassifyCursor {
  at: string
  threadId: string
}

export interface ReclassifyScopeSqlInput {
  organizationId: string
  inboxId: string
  window: ResolvedReclassifyWindow
  mode: MailReclassifyMode
  /**
   * Eligible tag ids, used ONLY by the `fill-gaps` "already categorised"
   * exclusion (guard exit 6, mirrored into SQL so the preview agrees with the
   * job). Ignored entirely in `re-classify` mode.
   */
  eligibleTagIds: string[]
  cursor?: ReclassifyCursor | null
}

/**
 * The FROM clause both the count and the page share.
 *
 * `JOIN LATERAL … LIMIT 1` is what makes R3 true in SQL rather than in a loop:
 * every row of this relation is ONE thread paired with the ONE message that will
 * be classified for it — its **first inbound message**. A thread with no inbound
 * message drops out entirely (an inner lateral), which is correct: there is
 * nothing to classify and nothing to key a marker on.
 *
 * "First" is ordered by `COALESCE(receivedAt, sentAt, createdAt)`, not by
 * `createdAt` alone: on a backfilled mailbox every row's `createdAt` is the
 * moment of the backfill, in provider order, which is not conversation order.
 * `isFirstInThread` is not used — it defaults to `true` and is unreliable on
 * imported mail.
 *
 * ⚠️ Why the first inbound message and not the latest (R-Q7): it establishes what
 * the conversation is about, whereas the latest message is often a one-line
 * follow-up ("any update?") carrying no signal. It also mirrors what the live
 * path effectively achieves, since exit 6 means the first message to arrive is
 * the one that decides the category.
 */
function reclassifySource(): SQL {
  return sql`
    "Thread" t
    JOIN LATERAL (
      SELECT m."id" AS "messageId",
             m."machineMailTier" AS "tier",
             m."subject" AS "subject",
             m."textPlain" AS "textPlain",
             m."fromId" AS "fromId",
             m."metadata" AS "metadata"
      FROM "Message" m
      WHERE m."threadId" = t."id" AND m."isInbound" = true
      ORDER BY COALESCE(m."receivedAt", m."sentAt", m."createdAt") ASC, m."id" ASC
      LIMIT 1
    ) fm ON TRUE
    LEFT JOIN "Participant" p ON p."id" = fm."fromId"
  `
}

/**
 * The WHERE clause both the count and the job page over.
 *
 * ⚠️ ONE predicate, two callers (invariant 10). The number in the confirm is the
 * number the user agreed to spend on, so a second implementation for the preview
 * would be a way to quietly charge for something else.
 *
 * The always-implicit exclusions (§2.4), none of which is ever offered as a
 * choice:
 *  - merged threads (they are not their own conversation);
 *  - ⚠️ `fm."tier" IS DISTINCT FROM 'hard'` — **invariant 4**. NULL means *not
 *    evaluated*, so `IS NULL` here would be very wrong;
 *  - in `fill-gaps` only: a first inbound message that already carries the C9
 *    marker (guard exit 5), and a thread that already carries an eligible tag
 *    (guard exit 6). Those two exclusions ARE the definition of fill-gaps, and
 *    dropping them is exactly what `re-classify` does.
 *
 * `lastMessageAt IS NOT NULL` is required because it is both the range axis and
 * the keyset axis; a thread with no recorded activity cannot be ordered
 * newest-first and has no inbound message to classify anyway.
 *
 * Timestamps are bound as ISO text and cast, mirroring what Drizzle's own
 * `timestamp` (no timezone) mapper does — `value.toISOString()` on write, read
 * back as UTC. A raw `Date` parameter would be reinterpreted in the session
 * timezone and shift the window.
 */
export function buildReclassifyWhere(input: ReclassifyScopeSqlInput): SQL {
  const { organizationId, inboxId, window, mode, eligibleTagIds, cursor } = input
  const clauses: SQL[] = [
    sql`t."organizationId" = ${organizationId}`,
    sql`t."inboxId" = ${inboxId}`,
    sql`t."mergedIntoThreadId" IS NULL`,
    sql`t."lastMessageAt" IS NOT NULL`,
    // ⚠️ INVARIANT 4 — NOT `IS NULL`. NULL is "not evaluated", not "human".
    sql`fm."tier" IS DISTINCT FROM 'hard'`,
  ]

  if (window.since) clauses.push(sql`t."lastMessageAt" >= ${window.since.toISOString()}::timestamp`)
  if (window.until) clauses.push(sql`t."lastMessageAt" < ${window.until.toISOString()}::timestamp`)

  if (mode === 'fill-gaps') {
    // Guard exit 5, in SQL. `-> key IS NULL` covers both "no metadata at all"
    // and "metadata without the marker".
    clauses.push(sql`fm."metadata" -> ${MAIL_CLASSIFICATION_METADATA_KEY} IS NULL`)
    // Guard exit 6, in SQL — scoped to ELIGIBLE tags only, exactly as the guard
    // scopes it. A thread carrying `VIP` or `P1` has not been categorised.
    if (eligibleTagIds.length > 0) {
      clauses.push(sql`NOT EXISTS (
        SELECT 1 FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf."id" = fv."fieldId"
        WHERE fv."entityId" = t."id"
          AND cf."organizationId" = ${organizationId}
          AND cf."systemAttribute" = 'thread_tags'
          AND fv."relatedEntityId" IN (${sql.join(
            eligibleTagIds.map((id) => sql`${id}`),
            sql`, `
          )})
      )`)
    }
  }

  if (cursor) {
    // Keyset, not OFFSET. The run MUTATES the columns the fill-gaps predicate
    // reads (it writes the marker and the tag), so an offset window would slide
    // underneath itself and skip rows. A descending keyset cannot: everything
    // already processed sits above the cursor.
    clauses.push(sql`(t."lastMessageAt", t."id") < (${cursor.at}::timestamp, ${cursor.threadId})`)
  }

  return sql.join(clauses, sql` AND `)
}

/**
 * ⚠️ Newest first, ALWAYS (invariant 8). If a run is cancelled or dies halfway
 * the user got the part that mattered, and it makes the preview honest: "the 500
 * most recent" is a thing a user can picture.
 */
const RECLASSIFY_ORDER = sql`ORDER BY t."lastMessageAt" DESC, t."id" DESC`

// ─────────────────────────────────────────────────────────────────────────────
// 3. Preconditions + count (§2.5, invariant 6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opted-in inbox ids for this org, from the `orgSettings` cache.
 *
 * Same read as `guard.ts`'s private `getOptedInInboxIds`, kept in step with it
 * deliberately: this path re-asserts the opt-in itself rather than trusting the
 * caller, because it is the one path that can be pointed at thousands of threads
 * at once (invariant 6).
 */
async function getOptedInInboxIds(organizationId: string): Promise<string[]> {
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  const raw = settings?.[MAIL_CLASSIFICATION_INBOX_IDS_SETTING]
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Everything a run needs resolved before it may touch a model. */
interface ReclassifyPreconditions {
  labels: MailClassificationLabel[]
  window: ResolvedReclassifyWindow
}

/**
 * C8's double guard, re-asserted for the bulk path (invariant 6).
 *
 * ⚠️ A re-run is a way to catch up, **not a way in**. An inbox that never opted
 * in must not become classifiable by asking for a retroactive run, and an org
 * with no eligible tags has nothing the model could legally answer.
 */
async function resolvePreconditions(
  db: Database,
  input: {
    organizationId: string
    inboxId: string
    range: MailReclassifyRange
    now?: Date
    hardCap?: number
  }
): Promise<Result<ReclassifyPreconditions, Error>> {
  const optedIn = await getOptedInInboxIds(input.organizationId)
  if (!optedIn.includes(input.inboxId)) {
    return err(
      new BadRequestError(
        'Turn on AI classification for this inbox before classifying its history.'
      )
    )
  }

  const labels = await getEligibleClassificationTags(db, input.organizationId)
  if (labels.length === 0) {
    return err(new BadRequestError('No categories are marked for AI classification yet.'))
  }

  const resolved = resolveReclassifyWindow(input.range, {
    now: input.now,
    hardCap: input.hardCap,
  })
  if (resolved.isErr()) return err(resolved.error)

  return ok({ labels, window: resolved.value })
}

export interface MailReclassifyCount {
  /** Threads in scope, clamped to {@link MailReclassifyCount.cap}. */
  count: number
  /** True when MORE threads matched than `cap` — render `count+`, never a bare number. */
  capped: boolean
  cap: number
  mode: MailReclassifyMode
  /** Eligible labels the run would classify into — the "N categories" in the copy. */
  eligibleTagCount: number
}

/**
 * How many threads a run over this scope would classify.
 *
 * ⚠️ The same predicate the job pages over ({@link buildReclassifyWhere}), so the
 * preview cannot drift from what actually runs (§2.5, invariant 10).
 *
 * Bounded by `LIMIT cap + 1` inside a subquery, so a large mailbox is bounded
 * work; the `+ 1` distinguishes "exactly the cap" from "more than the cap"
 * without a second query. Past the cap the caller renders `5,000+` — R-Q5
 * explicitly declines an exact total, so a confirm reading "5,000 of 5,000+" is
 * the honest wording, not "5,000 of 8,912".
 */
export async function countReclassifiableThreads(
  db: Database,
  input: {
    organizationId: string
    inboxId: string
    range: MailReclassifyRange
    mode: MailReclassifyMode
    now?: Date
    cap?: number
  }
): Promise<Result<MailReclassifyCount, Error>> {
  const pre = await resolvePreconditions(db, input)
  if (pre.isErr()) return err(pre.error)
  const { labels, window } = pre.value

  const cap = Math.max(1, Math.min(Math.trunc(input.cap ?? window.maxThreads), window.maxThreads))

  const where = buildReclassifyWhere({
    organizationId: input.organizationId,
    inboxId: input.inboxId,
    window,
    mode: input.mode,
    eligibleTagIds: labels.map((label) => label.tagId),
  })

  const result = await db.execute(sql`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM ${reclassifySource()} WHERE ${where} LIMIT ${cap + 1}
    ) AS bounded
  `)
  const raw = Number((result.rows?.[0] as { count?: number | string } | undefined)?.count ?? 0)
  const capped = raw > cap

  return ok({
    count: capped ? cap : raw,
    capped,
    cap,
    mode: input.mode,
    eligibleTagCount: labels.length,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Selection — one row per thread, one message each (§2.3)
// ─────────────────────────────────────────────────────────────────────────────

/** One thread paired with the single message that will be classified for it. */
export interface ReclassifyThreadRow {
  threadId: string
  /** The thread's FIRST INBOUND message (R3). */
  messageId: string
  /** `machineMailTier`, handed to the guard so exit 1 is honoured verbatim. */
  tier: 'hard' | 'soft' | null
  subject: string | null
  textPlain: string | null
  /** Sender identifier — the live path gets this from the event payload. */
  from: string | null
  /** Opaque keyset position for the next page. */
  cursor: ReclassifyCursor
}

/**
 * One page of threads, newest first (invariant 8).
 *
 * Exported for the job and for tests; callers page by feeding the last row's
 * `cursor` back in.
 */
export async function selectReclassifyThreadPage(
  db: Database,
  input: ReclassifyScopeSqlInput & { limit: number }
): Promise<ReclassifyThreadRow[]> {
  const limit = Math.max(1, Math.trunc(input.limit))
  const where = buildReclassifyWhere(input)

  const result = await db.execute(sql`
    SELECT t."id" AS "threadId",
           t."lastMessageAt"::text AS "cursorAt",
           fm."messageId" AS "messageId",
           fm."tier" AS "tier",
           fm."subject" AS "subject",
           fm."textPlain" AS "textPlain",
           p."identifier" AS "from"
    FROM ${reclassifySource()}
    WHERE ${where}
    ${RECLASSIFY_ORDER}
    LIMIT ${limit}
  `)

  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    threadId: String(row.threadId),
    messageId: String(row.messageId),
    tier: (row.tier as 'hard' | 'soft' | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    textPlain: (row.textPlain as string | null) ?? null,
    from: (row.from as string | null) ?? null,
    // `::text` on the way out and `::timestamp` on the way back in: a raw
    // `timestamp` column parsed by node-postgres becomes a Date in the LOCAL
    // zone, and round-tripping that through the keyset would shift the window.
    cursor: { at: String(row.cursorAt), threadId: String(row.threadId) },
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Per-thread context, with the parameterised exit-5 bypass (§2.6)
// ─────────────────────────────────────────────────────────────────────────────

type ThreadContextResult =
  | { proceed: true; context: MailClassificationContext }
  | { proceed: false; reason: MailClassificationSkipReason }

/**
 * Run the live guard for one selected thread, then apply the mode's bypass.
 *
 * ⚠️ Invariant 5 — the bypass lives HERE, as a parameter of the run, and never in
 * `guardClassification`. The guard's default stays "classify once, ever"; a
 * `re-classify` run is the caller saying it wants to pay again, which is exactly
 * what §2.6 says re-classification means.
 *
 * Only {@link BYPASSABLE_EXITS} are bypassed. `'inbox-not-opted-in'` and
 * `'no-eligible-tags'` stay fatal in both modes (invariant 6).
 *
 * ⚠️ Consequence of R3 worth knowing (§2.3): the marker is stamped on the FIRST
 * INBOUND message, not on the whole thread. Guard exit 5 is per-message, so a
 * later live message on the same thread is still technically classifiable — exit
 * 6 catches it via the applied tag. If a run applies NO tag (abstention), exit 6
 * does not catch it and the next inbound message on that thread is classified
 * normally. That is correct, not a leak, but it is surprising.
 */
async function resolveThreadContext(params: {
  db: Database
  organizationId: string
  row: ReclassifyThreadRow
  labels: MailClassificationLabel[]
  inboxId: string
  bypassAlreadyClassified: boolean
}): Promise<ThreadContextResult> {
  const { db, organizationId, row, labels, inboxId, bypassAlreadyClassified } = params

  const gate = await guardClassification({
    db,
    organizationId,
    messageId: row.messageId,
    threadId: row.threadId,
    machineMailTier: row.tier ?? undefined,
    from: row.from ?? undefined,
  })

  if (gate.proceed) return { proceed: true, context: gate.context }
  if (!bypassAlreadyClassified || !BYPASSABLE_EXITS.has(gate.reason)) {
    return { proceed: false, reason: gate.reason }
  }

  // The bypass. Everything the guard would have resolved is already in hand —
  // the selection query carried the message fields, and the labels were resolved
  // once for the whole run — so this rebuilds the context rather than re-reading.
  return {
    proceed: true,
    context: {
      organizationId,
      messageId: row.messageId,
      threadId: row.threadId,
      inboxId,
      labels,
      message: { subject: row.subject, from: row.from, textPlain: row.textPlain },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Sample mode (§2.11, R6) — PHASE 1's whole deliverable
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

export interface RunMailReclassifySampleInput {
  organizationId: string
  inboxId: string
  range: MailReclassifyRange
  mode: MailReclassifyMode
  /** Defaults to {@link MAIL_RECLASSIFY_SAMPLE_SIZE}. */
  sampleSize?: number
  /** Test/ops override for {@link MAIL_RECLASSIFY_THREAD_DELAY_MS}. */
  threadDelayMs?: number
  now?: Date
  /** Called after each thread, for the job's progress surface. */
  /** Called after each thread, for the job's progress surface. */
  onProgress?: (processed: number, total: number) => void
  /** Stop between threads. Safe at any point — a sample commits nothing. */
  isCancelled?: () => boolean
}

/**
 * Classify a sample of the chosen scope, report the distribution, **apply
 * nothing** (§2.11).
 *
 * This exists because the taxonomy is a hypothesis drawn from one org in one
 * vertical (`06-…` Q6). A sample answers "does this vocabulary fit this mail?"
 * for a few cents, before anyone spends on thousands of threads.
 *
 * ⚠️ Invariant 9 — IT APPLIES NOTHING AND WRITES NO MARKER. Neither
 * `applyClassificationTag` nor `markMessageClassified` is called here, and that
 * is not an oversight: a marker would silently disqualify the sampled threads
 * from the real `fill-gaps` run that follows. This is a deliberate "do not
 * persist" path, separate from the `inferred` flag (which is about spend).
 *
 * ⚠️ It still costs one inference per thread and still meters credits. It is
 * cheap only because N is small, and the UI states the cost like any other run.
 *
 * ⚠️ It does NOT re-run mail filters either (R2) — see the file header.
 *
 * The sample is the NEWEST N threads of the scope, not a random draw. Two
 * reasons: it keeps one ordering across preview, sample and run (invariant 8),
 * and it makes the §3.3 loop — sample → see it is wrong → fix the vocabulary →
 * sample again — actually readable, because a changed distribution is then
 * attributable to the edit rather than to a different draw. The cost is that a
 * seasonal recent skew is not averaged out; the default 30-day window keeps that
 * bounded.
 */
export async function runMailReclassifySample(
  db: Database,
  input: RunMailReclassifySampleInput
): Promise<Result<MailReclassifySampleReport, Error>> {
  const requested = Math.max(1, Math.trunc(input.sampleSize ?? MAIL_RECLASSIFY_SAMPLE_SIZE))
  const threadDelayMs = Math.max(0, input.threadDelayMs ?? MAIL_RECLASSIFY_THREAD_DELAY_MS)

  const pre = await resolvePreconditions(db, input)
  if (pre.isErr()) return err(pre.error)
  const { labels, window } = pre.value

  const rows = await selectReclassifyThreadPage(db, {
    organizationId: input.organizationId,
    inboxId: input.inboxId,
    window,
    mode: input.mode,
    eligibleTagIds: labels.map((label) => label.tagId),
    limit: Math.min(requested, window.maxThreads),
  })

  const counts = new Map<string, { count: number; confidenceSum: number }>()
  const skipped: Partial<Record<MailClassificationSkipReason, number>> = {}
  const abstainedByReason: Partial<Record<MailClassificationSkipReason, number>> = {}
  let inferred = 0
  let classified = 0
  let abstained = 0
  let confidenceSum = 0

  const note = (reason: MailClassificationSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const [index, row] of rows.entries()) {
    if (input.isCancelled?.()) break

    const resolved = await resolveThreadContext({
      db,
      organizationId: input.organizationId,
      row,
      labels,
      inboxId: input.inboxId,
      bypassAlreadyClassified: input.mode === 're-classify',
    }).catch((error) => {
      logger.warn('Sample guard failed for a thread — skipping it', {
        organizationId: input.organizationId,
        threadId: row.threadId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { proceed: false as const, reason: 'error' as const }
    })

    if (!resolved.proceed) {
      note(resolved.reason)
      input.onProgress?.(index + 1, rows.length)
      continue
    }

    const result = await classifyMessage(db, resolved.context)

    // ⚠️ NOTHING IS PERSISTED HERE. No `markMessageClassified`, no
    // `applyClassificationTag`, no filter re-run. Invariant 9 + R2.
    if (!result.inferred) {
      note(result.reason ?? 'error')
      input.onProgress?.(index + 1, rows.length)
      continue
    }

    inferred += 1
    confidenceSum += result.confidence
    if (result.tagId) {
      classified += 1
      const bucket = counts.get(result.tagId) ?? { count: 0, confidenceSum: 0 }
      bucket.count += 1
      bucket.confidenceSum += result.confidence
      counts.set(result.tagId, bucket)
    } else {
      abstained += 1
      // ⚠️ NOT into `skipped`. This inference completed and was billed; lumping
      // it in with the guard exits would hide the most informative number in the
      // report behind the least informative one.
      const reason = result.reason ?? 'no-category'
      abstainedByReason[reason] = (abstainedByReason[reason] ?? 0) + 1
    }

    input.onProgress?.(index + 1, rows.length)
    if (index < rows.length - 1) await sleep(threadDelayMs)
  }

  const report: MailReclassifySampleReport = {
    inboxId: input.inboxId,
    mode: input.mode,
    requested,
    selected: rows.length,
    inferred,
    classified,
    abstained,
    abstentionRate: inferred > 0 ? abstained / inferred : 0,
    meanConfidence: inferred > 0 ? confidenceSum / inferred : 0,
    // ⚠️ EVERY eligible label, including the never-chosen ones. A zero row IS the
    // finding (§3.3 / 06 Q1) — filtering it out deletes the answer.
    labels: labels.map((label) => {
      const bucket = counts.get(label.tagId)
      return {
        tagId: label.tagId,
        title: label.title,
        count: bucket?.count ?? 0,
        meanConfidence: bucket && bucket.count > 0 ? bucket.confidenceSum / bucket.count : 0,
      }
    }),
    skipped,
    abstainedByReason,
    applied: false,
  }

  logger.info('Mail re-classification sample finished', {
    organizationId: input.organizationId,
    ...report,
    labels: report.labels.map((label) => `${label.title}:${label.count}`),
  })

  return ok(report)
}

// ─────────────────────────────────────────────────────────────────────────────
// 6b. The full run (§4 phase 2) — the sample's loop, with an apply path
// ─────────────────────────────────────────────────────────────────────────────

export interface RunMailReclassifyApplyInput {
  organizationId: string
  inboxId: string
  range: MailReclassifyRange
  mode: MailReclassifyMode
  /** Test/ops override for {@link MAIL_RECLASSIFY_THREAD_DELAY_MS}. */
  threadDelayMs?: number
  /** Test override for {@link MAIL_RECLASSIFY_PAGE_SIZE}. */
  pageSize?: number
  now?: Date
  /**
   * ⚠️ Carries `startedAtIso` as well as the counts, and that is not cosmetic.
   * BullMQ keeps `progress` on a job even when the job FAILS, whereas a return
   * value only exists for a run that reached its end. A run the worker dies
   * under — a deploy, a dev `--watch` restart — has therefore already applied
   * tags and produced no report, so without this there is no scope key and its
   * work cannot be undone. See {@link getMailReclassifyRunStatus}.
   */
  onProgress?: (processed: number, total: number, startedAtIso: string) => void
  /**
   * Stop between threads. Safe at ANY point (§2.5): each thread is committed on
   * its own, so a cancelled run is a partial run, never a broken one.
   */
  isCancelled?: () => boolean
}

/**
 * Classify the chosen scope and APPLY the results (§4 phase 2).
 *
 * The sample's loop with three differences, and only three:
 *
 *  1. it **pages** with a keyset cursor instead of taking one page, because the
 *     scope can be thousands of threads rather than ~100;
 *  2. it calls `applyClassificationTag` and `markMessageClassified`;
 *  3. it reports what it changed rather than a distribution to reason about.
 *
 * ⚠️ **It still does NOT re-run mail filters** (R2, §2.12, invariant 3). This is
 * the deliberate exception to `05-…` invariant 15, and it is the single thing
 * most likely to be "fixed" by someone noticing the inconsistency. Firing
 * `assign` / `archive` / `run-agent` across a historical backlog is the
 * late-filter-action problem: threads resolved a fortnight ago get re-routed. A
 * retroactive run tags and stops. If a user wants filters applied to the newly
 * tagged backlog, `mail-filters/retroactive.ts` is a separate action they
 * trigger themselves.
 *
 * ⚠️ **Resumable by construction, not by bookkeeping.** A completed thread has a
 * marker, so re-running the same scope in `fill-gaps` mode picks up exactly what
 * did not finish. A failed call leaves NO marker (`05-…§12.6`), so provider
 * errors self-heal on the next run instead of being written off — which is also
 * why cancellation needs no checkpoint of its own.
 */
export async function runMailReclassifyApply(
  db: Database,
  input: RunMailReclassifyApplyInput
): Promise<Result<MailReclassifyRunReport, Error>> {
  const startedAt = input.now ?? new Date()
  const threadDelayMs = Math.max(0, input.threadDelayMs ?? MAIL_RECLASSIFY_THREAD_DELAY_MS)
  const pageSize = Math.max(1, Math.trunc(input.pageSize ?? MAIL_RECLASSIFY_PAGE_SIZE))

  const pre = await resolvePreconditions(db, input)
  if (pre.isErr()) return err(pre.error)
  const { labels, window } = pre.value
  const eligibleTagIds = labels.map((label) => label.tagId)

  // The count the confirm was based on, re-read here so the report can say what
  // the cap removed. Same predicate as the run below (invariant 10).
  const counted = await countReclassifiableThreads(db, {
    organizationId: input.organizationId,
    inboxId: input.inboxId,
    range: input.range,
    mode: input.mode,
    now: input.now,
  })
  const inScope = counted.isOk() ? counted.value.count : 0
  const total = Math.min(inScope, window.maxThreads)
  const capped = Math.max(0, inScope - total)

  const counts = new Map<string, { count: number; confidenceSum: number }>()
  const skipped: Partial<Record<MailClassificationSkipReason, number>> = {}
  let selected = 0
  let inferred = 0
  let applied = 0
  let abstained = 0
  let cancelled = false

  const note = (reason: MailClassificationSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  // ⚠️ Published BEFORE the first thread, so the undo key exists from the moment
  // the run can have changed anything. A run that dies on thread 1 has still
  // applied a tag on thread 1.
  input.onProgress?.(0, total, startedAt.toISOString())

  let cursor: ReclassifyCursor | undefined
  pager: while (selected < total) {
    const rows = await selectReclassifyThreadPage(db, {
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      window,
      mode: input.mode,
      eligibleTagIds,
      cursor,
      limit: Math.min(pageSize, total - selected),
    })
    if (rows.length === 0) break

    for (const row of rows) {
      if (input.isCancelled?.()) {
        cancelled = true
        break pager
      }
      selected += 1

      const resolved = await resolveThreadContext({
        db,
        organizationId: input.organizationId,
        row,
        labels,
        inboxId: input.inboxId,
        bypassAlreadyClassified: input.mode === 're-classify',
      }).catch((error) => {
        logger.warn('Run guard failed for a thread — skipping it', {
          organizationId: input.organizationId,
          threadId: row.threadId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { proceed: false as const, reason: 'error' as const }
      })

      if (!resolved.proceed) {
        note(resolved.reason)
        input.onProgress?.(selected, total, startedAt.toISOString())
        continue
      }

      const result = await classifyMessage(db, resolved.context)

      // ⚠️ The marker is gated on `inferred`, never on "did we get a tag"
      // (`05-…§12.6`). A quota or provider failure spent nothing and decided
      // nothing, so stamping it would disqualify the thread from every future
      // run over one transient 429.
      if (!result.inferred) {
        note(result.reason ?? 'error')
        input.onProgress?.(selected, total, startedAt.toISOString())
        continue
      }

      inferred += 1
      if (result.tagId) {
        const ok = await applyClassificationTag({
          db,
          organizationId: input.organizationId,
          threadId: row.threadId,
          tagId: result.tagId,
        })
        if (ok) {
          applied += 1
          const bucket = counts.get(result.tagId) ?? { count: 0, confidenceSum: 0 }
          bucket.count += 1
          bucket.confidenceSum += result.confidence
          counts.set(result.tagId, bucket)
        }
      } else {
        abstained += 1
      }

      // ⚠️ Stamped on the FIRST INBOUND message only, not the thread (§2.3).
      // Guard exit 5 is per-message, so a later live message on this thread is
      // still technically classifiable — exit 6 catches it via the applied tag.
      // When the run ABSTAINED there is no tag, so exit 6 does not catch it and
      // the next inbound message is classified normally. That is correct, and
      // surprising enough to say out loud.
      await markMessageClassified({
        db,
        organizationId: input.organizationId,
        messageId: row.messageId,
        marker: {
          at: new Date().toISOString(),
          tagId: result.tagId,
          confidence: result.confidence,
          ...(result.model ? { model: result.model } : {}),
        },
      })

      input.onProgress?.(selected, total, startedAt.toISOString())
      await sleep(threadDelayMs)
    }

    cursor = rows[rows.length - 1]?.cursor
    if (!cursor) break
  }

  const report: MailReclassifyRunReport = {
    inboxId: input.inboxId,
    mode: input.mode,
    startedAtIso: startedAt.toISOString(),
    selected,
    capped,
    inferred,
    applied,
    abstained,
    skipped,
    labels: labels.map((label) => {
      const bucket = counts.get(label.tagId)
      return {
        tagId: label.tagId,
        title: label.title,
        count: bucket?.count ?? 0,
        meanConfidence: bucket && bucket.count > 0 ? bucket.confidenceSum / bucket.count : 0,
      }
    }),
    cancelled,
  }

  logger.info('Mail re-classification run finished', {
    organizationId: input.organizationId,
    ...report,
    labels: report.labels.map((label) => `${label.title}:${label.count}`),
  })

  return ok(report)
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. The queue job (§2.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface MailReclassifySampleJobData {
  organizationId: string
  inboxId: string
  range: MailReclassifyRange
  mode: MailReclassifyMode
  sampleSize?: number
  threadDelayMs?: number
  /** For the log trail only — the run still executes as SYSTEM. */
  requestedByUserId?: string
}

/** Deterministic per (org, inbox), so a double-click collapses into one run. */
export function mailReclassifySampleJobId(organizationId: string, inboxId: string): string {
  return `mail-reclassify-sample:${organizationId}:${inboxId}`
}

/**
 * Run one sample on the queue.
 *
 * ⚠️ NEVER THROWS, and never retries. A thrown job would be retried by BullMQ
 * (the queue default is `attempts: 5`) and every retry re-spends the whole
 * sample, which is the same class of bug as re-inferring a marked message. The
 * enqueue below pins `attempts: 1` and this handler returns its failures.
 */
export async function mailReclassifySampleJob(
  ctx: JobContext<MailReclassifySampleJobData>
): Promise<MailReclassifySampleReport | { skipped: string }> {
  const { database } = await import('@auxx/database')
  const { organizationId, inboxId, range, mode, sampleSize, threadDelayMs } = ctx.data

  const result = await runMailReclassifySample(database, {
    organizationId,
    inboxId,
    range,
    mode,
    sampleSize,
    threadDelayMs,
    isCancelled: () => ctx.isCancelled?.() ?? false,
    onProgress: (processed, total) => {
      // Object progress so the dialog can render "340 of 1,204" (§3.1) rather
      // than a bare percentage. Fire-and-forget: a progress write must never
      // fail a run that has already spent money.
      void ctx.job?.updateProgress({ processed, total })?.catch(() => {})
    },
  }).catch((error) => {
    // The selection query is the only thing left that can throw, and a throw
    // here would surface as a failed job with no report at all. Turn it into a
    // reported skip so the dialog can say what happened.
    logger.error('Mail re-classification sample failed', {
      organizationId,
      inboxId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  })

  if (result.isErr()) {
    logger.warn('Mail re-classification sample skipped', {
      organizationId,
      inboxId,
      reason: result.error.message,
    })
    return { skipped: result.error.message }
  }
  return result.value
}

/** What {@link enqueueMailReclassifySample} decided. */
export interface EnqueueMailReclassifySampleResult {
  jobId: string
  /** True when an in-flight run was returned instead of a new one being started. */
  deduplicated: boolean
  /**
   * The scope of the run already in flight — set only when `deduplicated`, and
   * only when the job still carried readable data.
   *
   * ⚠️ The caller must compare this against what it asked for
   * ({@link isSameReclassifyScope}). The `jobId` is keyed on (org, inbox), so a
   * collapse says nothing about whether the running job matches the request.
   */
  running?: { range: MailReclassifyRange; mode: MailReclassifyMode }
}

/**
 * Enqueue a sample, collapsing a double-click into one run.
 *
 * The `jobId` is deterministic, so an in-flight sample is returned as-is rather
 * than duplicated. A FINISHED sample is removed first, because §3.3's loop —
 * sample, fix the vocabulary, sample again — has to be able to re-run the same
 * scope; otherwise BullMQ would hand back the stale report.
 *
 * ⚠️ **A collapse is not a start.** The id is per (org, inbox) and carries no
 * scope, so this can only report *that* it collapsed and *into what*; deciding
 * whether that is acceptable is the caller's, because only the caller knows
 * whether it was about to write an audit row claiming a run began.
 */
export async function enqueueMailReclassifySample(
  input: MailReclassifySampleJobData
): Promise<Result<EnqueueMailReclassifySampleResult, Error>> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const jobId = mailReclassifySampleJobId(input.organizationId, input.inboxId)

  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState().catch(() => 'unknown')
    // Anything not yet finished counts as in flight — BullMQ has more waiting
    // states than the obvious three (`prioritized`, `waiting-children`), and
    // treating an unrecognised one as finished would remove a job that is about
    // to spend money.
    if (state !== 'completed' && state !== 'failed') {
      const data = existing.data as MailReclassifySampleJobData | undefined
      return ok({
        jobId,
        deduplicated: true,
        ...(data?.range && data?.mode ? { running: { range: data.range, mode: data.mode } } : {}),
      })
    }
    await existing.remove().catch(() => {})
  }

  await queue.add(MAIL_RECLASSIFY_SAMPLE_JOB_NAME, input satisfies MailReclassifySampleJobData, {
    jobId,
    // ⚠️ ONE attempt. Every retry would re-spend ~100 inferences for the same
    // answer — the bulk-path equivalent of the C9 double-billing bug.
    attempts: 1,
    // The report IS the deliverable (§3.3), so the completed job has to survive
    // long enough for the dialog to read it back.
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 3600 },
  })
  return ok({ jobId, deduplicated: false })
}

/** Poll one inbox's sample, for the dialog (§3.3) and the card's progress row. */
export async function getMailReclassifySampleStatus(
  organizationId: string,
  inboxId: string
): Promise<MailReclassifySampleStatus | null> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const jobId = mailReclassifySampleJobId(organizationId, inboxId)
  const job = await queue.getJob(jobId)
  if (!job) return null

  const rawState = await job.getState().catch(() => 'unknown')
  const progress = (job.progress ?? {}) as { processed?: number; total?: number }
  const value = job.returnvalue as MailReclassifySampleReport | { skipped: string } | undefined

  const KNOWN: MailReclassifySampleStatus['state'][] = [
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  ]
  const state = KNOWN.find((known) => known === rawState) ?? 'unknown'

  return {
    jobId,
    state,
    processed: typeof progress.processed === 'number' ? progress.processed : 0,
    total: typeof progress.total === 'number' ? progress.total : 0,
    // `applied` is the discriminator: the skipped shape has no such key, so a
    // precondition failure never renders as an all-zero distribution.
    report: value && 'applied' in value ? value : undefined,
  }
}

/**
 * Cancel a queued sample.
 *
 * Removes it outright when it has not started. An ACTIVE job is left alone and
 * `false` is returned: BullMQ cancellation is the worker's abort signal, which
 * {@link runMailReclassifySample} honours between threads via `isCancelled`, and
 * stopping is safe at any point because a sample commits nothing.
 */
export async function cancelMailReclassifySample(
  organizationId: string,
  inboxId: string
): Promise<boolean> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const job = await queue.getJob(mailReclassifySampleJobId(organizationId, inboxId))
  if (!job) return false
  const state = await job.getState().catch(() => 'unknown')
  if (state === 'active') return false
  await job.remove().catch(() => {})
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. The full run's queue surface (§4 phase 2)
// ─────────────────────────────────────────────────────────────────────────────

export interface MailReclassifyApplyJobData {
  organizationId: string
  inboxId: string
  range: MailReclassifyRange
  mode: MailReclassifyMode
  threadDelayMs?: number
  /** For the log trail only — the run still executes as SYSTEM. */
  requestedByUserId?: string
}

/** Deterministic per (org, inbox), so a double-click collapses into one run. */
export function mailReclassifyApplyJobId(organizationId: string, inboxId: string): string {
  // ⚠️ Three colon-separated parts, and that is LOAD-BEARING, not cosmetic.
  // BullMQ rejects a custom jobId containing `:` unless it splits into exactly
  // three (`05-…§12.7.1`). Adding or removing a segment here breaks every run.
  return `mail-reclassify-apply:${organizationId}:${inboxId}`
}

/**
 * Run one full apply on the queue.
 *
 * ⚠️ NEVER THROWS, and never retries. A retry would re-classify every thread the
 * run had already paid for — the bulk equivalent of the C9 double-billing bug.
 * The enqueue pins `attempts: 1` and this handler returns its failures.
 */
export async function mailReclassifyApplyJob(
  ctx: JobContext<MailReclassifyApplyJobData>
): Promise<MailReclassifyRunReport | { skipped: string }> {
  const { database } = await import('@auxx/database')
  const { organizationId, inboxId, range, mode, threadDelayMs } = ctx.data

  const result = await runMailReclassifyApply(database, {
    organizationId,
    inboxId,
    range,
    mode,
    threadDelayMs,
    isCancelled: () => ctx.isCancelled?.() ?? false,
    onProgress: (processed, total, startedAtIso) => {
      void ctx.job?.updateProgress({ processed, total, startedAtIso })?.catch(() => {})
    },
  }).catch((error) => {
    logger.error('Mail re-classification run failed', {
      organizationId,
      inboxId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  })

  if (result.isErr()) {
    logger.warn('Mail re-classification run skipped', {
      organizationId,
      inboxId,
      reason: result.error.message,
    })
    return { skipped: result.error.message }
  }
  return result.value
}

/**
 * Enqueue a full run, collapsing a double-click into one.
 *
 * ⚠️ A FINISHED run is removed before a new one is added, exactly as the sample
 * does — otherwise BullMQ hands back the previous report and the card claims a
 * run that never happened. Whether collapsing is acceptable is the CALLER's
 * decision (the id carries no scope), so the in-flight scope is reported back.
 */
export async function enqueueMailReclassifyApply(
  input: MailReclassifyApplyJobData
): Promise<Result<EnqueueMailReclassifySampleResult, Error>> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const jobId = mailReclassifyApplyJobId(input.organizationId, input.inboxId)

  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState().catch(() => 'unknown')
    if (state !== 'completed' && state !== 'failed') {
      const data = existing.data as MailReclassifyApplyJobData | undefined
      return ok({
        jobId,
        deduplicated: true,
        ...(data?.range && data?.mode ? { running: { range: data.range, mode: data.mode } } : {}),
      })
    }
    await existing.remove().catch(() => {})
  }

  await queue.add(MAIL_RECLASSIFY_APPLY_JOB_NAME, input satisfies MailReclassifyApplyJobData, {
    jobId,
    // ⚠️ ONE attempt — see the job handler.
    attempts: 1,
    // The report carries the undo key (`startedAtIso`), so it has to outlive the
    // run long enough for somebody to change their mind. A day, not an hour.
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 86_400 },
  })
  return ok({ jobId, deduplicated: false })
}

/** Poll one inbox's run, for the backlog row's progress surface (§3.1). */
export async function getMailReclassifyRunStatus(
  organizationId: string,
  inboxId: string
): Promise<MailReclassifyRunStatus | null> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const job = await queue.getJob(mailReclassifyApplyJobId(organizationId, inboxId))
  if (!job) return null

  const rawState = await job.getState().catch(() => 'unknown')
  const progress = (job.progress ?? {}) as {
    processed?: number
    total?: number
    startedAtIso?: string
  }
  const value = job.returnvalue as MailReclassifyRunReport | { skipped: string } | undefined

  const KNOWN: MailReclassifyRunStatus['state'][] = [
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  ]

  // `startedAtIso` is the discriminator — a `{ skipped }` value has no such key,
  // so a precondition failure never renders as an all-zero run.
  const report = value && 'startedAtIso' in value ? value : undefined

  return {
    jobId: job.id ?? mailReclassifyApplyJobId(organizationId, inboxId),
    state: KNOWN.find((known) => known === rawState) ?? 'unknown',
    processed: typeof progress.processed === 'number' ? progress.processed : 0,
    total: typeof progress.total === 'number' ? progress.total : 0,
    report,
    // ⚠️ Progress FIRST, report second. The report only exists for a run that
    // ended; progress survives a run the worker died under, and that is exactly
    // the run whose applied tags somebody needs to reverse.
    startedAtIso: progress.startedAtIso ?? report?.startedAtIso,
    ...(job.failedReason ? { failedReason: job.failedReason } : {}),
  }
}

/**
 * Cancel a run.
 *
 * ⚠️ Unlike the sample, an ACTIVE run has already spent money and already
 * changed data, so removing the job outright would throw away the report — and
 * the report carries `startedAtIso`, which is undo's only scope key. An active
 * run is therefore asked to stop (BullMQ's abort signal, honoured between
 * threads) and left to finish reporting; only a queued one is removed.
 */
export async function cancelMailReclassifyRun(
  organizationId: string,
  inboxId: string
): Promise<boolean> {
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../jobs/queues'),
    import('../jobs/queues/types'),
  ])
  const queue = getQueue(Queues.maintenanceQueue)
  const job = await queue.getJob(mailReclassifyApplyJobId(organizationId, inboxId))
  if (!job) return false
  const state = await job.getState().catch(() => 'unknown')
  if (state === 'active') return false
  await job.remove().catch(() => {})
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Undo (§2.7, R7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reverse a run's tag applications.
 *
 * `05-…§8` recorded that bulk undo could not be built because provenance was too
 * coarse — "we can tell which *tags* the AI may apply, not which *applications*
 * it made". **That predates the C9 marker.** `Message.metadata.mailClassification`
 * records `{ at, tagId, … }` per message, so for any message we know exactly
 * which tag the classifier applied and when. Undo is: find the markers this run
 * wrote, and remove those tags from those threads.
 *
 * ## Scope key is TIME, not a run id
 *
 * There is no run table, and adding one to support undo would be a schema for a
 * value the marker already carries. `sinceIso` comes from the report's
 * `startedAtIso`, and every marker the run wrote has an `at` at or after it.
 *
 * ⚠️ The consequence is that undo is bounded by *when*, not by *which run*. Two
 * runs on one inbox inside the same window undo together. Acceptable because the
 * jobId is per-inbox, so two concurrent runs on one inbox cannot exist — but a
 * caller passing an old `sinceIso` will reach further back than it expects.
 *
 * ## What it refuses to touch (R-Q6)
 *
 * ⚠️ **The marker says "the AI applied this", never "only the AI applied this".**
 * A human or an `add-tag` rule may have applied the same tag to the same thread,
 * and removing it on marker evidence alone destroys their work. So a thread
 * carrying MORE than one eligible tag is left entirely alone and counted in
 * `skippedSharedTag` — the conservative arm of R-Q6, with the imprecision
 * reported rather than hidden.
 *
 * ⚠️ A marker whose `tagId` no longer resolves (the category was deleted, or
 * `076` reshaped it) is a logged no-op, never an error — invariant 13.
 *
 * Never throws.
 */
export async function undoMailReclassifyRun(
  db: Database,
  input: { organizationId: string; inboxId: string; sinceIso: string }
): Promise<Result<MailReclassifyUndoReport, Error>> {
  const since = new Date(input.sinceIso)
  if (Number.isNaN(since.getTime())) {
    return err(new BadRequestError('That is not a valid run start time.'))
  }

  const labels = await getEligibleClassificationTags(db, input.organizationId)
  const eligible = new Set(labels.map((label) => label.tagId))
  // No eligible labels means nothing the classifier could have applied, and it
  // also means the `IN (…)` below would be empty and invalid. Both say "stop".
  if (eligible.size === 0) {
    return ok({ inboxId: input.inboxId, removed: 0, skippedSharedTag: 0, staleMarkers: 0 })
  }
  // ⚠️ `sql.join` of individual `sql` fragments, NOT `sql.raw` of a joined
  // string. These ids are DB-sourced cuids today, so hand-quoting would work —
  // right up until someone reuses this shape where the list IS user input.
  // Parameterize by default; a raw list is a habit, not a decision.
  const eligibleList = sql.join(
    [...eligible].map((id) => sql`${id}`),
    sql`, `
  )

  // Markers this run wrote, with the thread they landed on and how many eligible
  // tags that thread currently carries. The count is what implements R-Q6, and
  // it has to be read in the SAME query — computing it separately would race a
  // human tagging the thread mid-undo.
  const rows = (
    await db.execute(sql`
      SELECT m."threadId"                                            AS "threadId",
             m."metadata" -> ${MAIL_CLASSIFICATION_METADATA_KEY} ->> 'tagId' AS "tagId",
             (
               SELECT count(*)
               FROM "FieldValue" tv
               WHERE tv."entityId" = m."threadId"
                 AND tv."organizationId" = ${input.organizationId}
                 AND tv."relatedEntityId" IN (${eligibleList})
             )                                                        AS "eligibleTagCount"
      FROM "Message" m
      JOIN "Thread" t ON t."id" = m."threadId"
      WHERE m."organizationId" = ${input.organizationId}
        AND t."inboxId" = ${input.inboxId}
        AND m."metadata" -> ${MAIL_CLASSIFICATION_METADATA_KEY} ->> 'tagId' IS NOT NULL
        AND (m."metadata" -> ${MAIL_CLASSIFICATION_METADATA_KEY} ->> 'at')::timestamptz >= ${since.toISOString()}::timestamptz
    `)
  ).rows as Array<Record<string, unknown>>

  let removed = 0
  let skippedSharedTag = 0
  let staleMarkers = 0

  // Grouped by tag so one `tagThreadsBulk` call covers every thread that got the
  // same label — the same batching the apply path would have wanted.
  const byTag = new Map<string, string[]>()
  for (const row of rows) {
    const tagId = String(row.tagId)
    const threadId = String(row.threadId)
    if (!eligible.has(tagId)) {
      staleMarkers += 1
      continue
    }
    if (Number(row.eligibleTagCount ?? 0) > 1) {
      skippedSharedTag += 1
      continue
    }
    const list = byTag.get(tagId) ?? []
    list.push(threadId)
    byTag.set(tagId, list)
  }

  if (byTag.size > 0) {
    // Lazy, like `apply.ts`: a static edge drags the realtime barrel into every
    // importer's graph and breaks `vi.mock` in unit tests.
    const [{ requireCachedEntityDefId }, { ThreadMutationService }, { SYSTEM_VISIBILITY }] =
      await Promise.all([
        import('../cache'),
        import('../threads/thread-mutation.service'),
        import('../permissions/visibility/context'),
      ])
    const [threadDefId, tagDefId] = await Promise.all([
      requireCachedEntityDefId(input.organizationId, 'thread'),
      requireCachedEntityDefId(input.organizationId, 'tag'),
    ])
    const service = new ThreadMutationService(
      input.organizationId,
      db,
      undefined,
      undefined,
      SYSTEM_VISIBILITY
    )

    for (const [tagId, threadIds] of byTag) {
      try {
        await service.tagThreadsBulk(
          threadIds.map((id) => toRecordId(threadDefId, id)),
          [toRecordId(tagDefId, tagId)],
          'remove'
        )
        removed += threadIds.length
      } catch (error) {
        // One tag failing must not abandon the rest of the undo.
        logger.error('Undo failed to remove a classified tag', {
          organizationId: input.organizationId,
          tagId,
          threads: threadIds.length,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // ⚠️ The MARKERS ARE LEFT IN PLACE, deliberately. They record that an inference
  // happened and was paid for; clearing them would make `fill-gaps` re-classify
  // and re-bill every undone thread on the next run, which is the opposite of
  // what someone who just undid a run wants.
  const report: MailReclassifyUndoReport = {
    inboxId: input.inboxId,
    removed,
    skippedSharedTag,
    staleMarkers,
  }
  logger.info('Mail re-classification undo finished', {
    organizationId: input.organizationId,
    ...report,
  })
  return ok(report)
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. The post-sync prompt (§3.4, phase 3)
// ─────────────────────────────────────────────────────────────────────────────

/** The one inbox worth asking about, as the mail-UI banner renders it. */
export interface PendingClassificationPrompt {
  inboxId: string
  /** Unclassified threads, capped — the copy renders `M+` past the cap. */
  threadCount: number
  threadCountCapped: boolean
  /** How many labels the classifier could choose from, for the copy. */
  labelCount: number
}

/**
 * The one inbox worth prompting about, or `null` (§3.4).
 *
 * §2.9's problem: an inbox that finished syncing last week has no completion
 * event left to hang a prompt on, and the backlog row in settings is only seen
 * by someone who goes looking. This is the other trigger — mounted in the mail
 * UI, because the person who should answer is the one looking at the mail.
 *
 * ⚠️ **Never automatic** (R1). This decides whether the QUESTION is worth
 * asking; the run still needs a click, and that click lands on the same paged,
 * cancellable, undoable path as the settings button.
 *
 * `candidateInboxIds` is the caller's already-authorized set minus the ones this
 * user dismissed, so this function holds no permission logic of its own — the
 * house rule, and the same shape `findPendingRetroactivePrompt` uses.
 *
 * The conditions, cheapest first:
 *  1. the org has at least one eligible label — otherwise there is nothing to
 *     classify INTO, and C8's double guard would refuse the run anyway;
 *  2. the inbox is opted in (invariant 6 — a prompt is not a way past the
 *     opt-in, it is a nudge for someone who already said yes);
 *  3. a live channel on it has FINISHED a sync at least once and is not
 *     mid-sync — R-Q8, the same refusal the router makes, because a prompt that
 *     appears mid-backfill invites a run that races the sync;
 *  4. it actually has unclassified threads.
 *
 * ⚠️ **There is no "has a run ever happened" check, deliberately.** The filter
 * prompt can ask that because a `MailFilterRun` row is permanent; a
 * classification run's only record is a BullMQ job reaped a day later. Condition
 * 4 is the honest substitute and it is self-limiting: a completed run stamps a
 * marker on every thread it touched — including the ones it abstained on — so
 * the backlog goes to zero and the prompt stops on its own. A partial or
 * cancelled run leaves a real backlog, and asking again about real backlog is
 * correct, not nagging. Dismissal covers the person who disagrees.
 */
export async function findPendingClassificationPrompt(
  db: Database,
  organizationId: string,
  candidateInboxIds: string[],
  opts: { threadCountCap?: number; preferredInboxId?: string } = {}
): Promise<PendingClassificationPrompt | null> {
  if (candidateInboxIds.length === 0) return null
  const cap = Math.max(1, Math.trunc(opts.threadCountCap ?? MAIL_RECLASSIFY_BACKLOG_COUNT_CAP))

  const labels = await getEligibleClassificationTags(db, organizationId)
  if (labels.length === 0) return null

  const optedIn = new Set(await getOptedInInboxIds(organizationId))
  let candidates = candidateInboxIds.filter((id) => optedIn.has(id))
  if (candidates.length === 0) return null

  /**
   * The inbox the caller is currently LOOKING at goes first, when it is one of
   * the candidates. The banner mounts in a fixed slot for every mail view and
   * names the inbox it is about, so without this it asks about whichever inbox
   * happened to sort first — reading, to anyone in a different mailbox, as a
   * statement about the mail in front of them.
   *
   * ⚠️ A REORDER, never a filter, and it runs AFTER the authority-derived
   * `candidateInboxIds` have been narrowed — so an id the caller may not
   * configure is inert here rather than an existence oracle, and a view with no
   * inbox of its own (search, drafts, all-inboxes) still gets the prompt.
   */
  const preferred = opts.preferredInboxId
  if (preferred && candidates.includes(preferred)) {
    candidates = [preferred, ...candidates.filter((id) => id !== preferred)]
  }

  // R-Q8 again: an inbox still filling up must not be prompted, because the run
  // it invites would miss everything still arriving.
  const synced = await db
    .select({ inboxId: schema.InboxIntegration.inboxId })
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
  const syncedInboxIds = new Set(synced.map((row) => row.inboxId))

  // Candidate order is the caller's, so the prompt is stable across refetches
  // rather than whichever inbox a query happened to return first.
  for (const inboxId of candidates) {
    if (!syncedInboxIds.has(inboxId)) continue

    const counted = await countReclassifiableThreads(db, {
      organizationId,
      inboxId,
      range: { kind: 'all-time' },
      mode: 'fill-gaps',
      cap,
    })
    if (counted.isErr() || counted.value.count === 0) continue

    return {
      inboxId,
      threadCount: counted.value.count,
      threadCountCapped: counted.value.capped,
      labelCount: labels.length,
    }
  }

  return null
}
