// packages/lib/src/mail-suggestions/mine.ts
// THE mining layer (plans/mail-filter/03-suggestions-plan.md §5): one indexed
// grouped query per inbox over a 90-day window, then the thresholds and the four
// suppression rules that decide what — if anything — becomes a card.
//
// NO ROLLUP COUNTERS, NO NEW AGGREGATE TABLE (S8). The whole analysis layer is
// the statement in {@link buildInboxGroupQuery} plus the pure decision function
// {@link buildMailSuggestionDrafts}, which is deliberately separable from the
// database so every threshold boundary and every suppression rule is testable
// without one.
//
// ZERO permission checks (lib-module-guide §6): this runs from a worker with no
// caller at all. Personal-vs-shared is a DATA question here (whose read state
// counts, whose `userId` the card carries), never an authorization one.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { Condition, ConditionGroup } from '../conditions/types'
import { getMailFilterFields } from '../mail-filters/client'
import { assertFilterConditionsCompile } from '../mail-filters/evaluate'
import { assertFilterShape } from '../mail-filters/mutations'
import type { MailFilterAction } from '../mail-filters/types'
import { resolveUnsubscribeMethod } from './client'
import { pruneStaleMailSuggestions, upsertMailSuggestions } from './mutations'
import { listSuppressedSubjectKeys } from './queries'
import type {
  MailSuggestionDraft,
  MailSuggestionEvidence,
  MailSuggestionKind,
  MailUnsubscribeMeta,
} from './types'

const logger = createScopedLogger('mail-suggestions-mine')

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLDS (§5.2) — below any of these, produce nothing
// ═══════════════════════════════════════════════════════════════════════════

/** The mining window. Also the retention window for undecided cards (§5.4). */
export const SUGGESTION_WINDOW_DAYS = 90

/**
 * Volume floors. Without them the first week of a newly connected mailbox
 * generates a wall of suggestions about mail that arrived twice.
 */
export const MIN_MESSAGES = 5
/** @see MIN_MESSAGES */
export const MIN_THREADS = 3
/** @see MIN_MESSAGES */
export const MIN_HISTORY_DAYS = 14

/** Share of the group's threads nobody opened, for an unsubscribe proposal. */
export const UNREAD_RATE_THRESHOLD = 0.8
/** Share of the group's threads archived BY HAND, for an auto-archive proposal. */
export const MANUAL_ARCHIVE_RATE_THRESHOLD = 0.8
/** "The last N all got the same tag/assignee", for auto-tag / auto-assign. */
export const CONSISTENCY_THRESHOLD = 0.8

/**
 * Share of a group's threads an existing filter already fired on, above which
 * the group is considered ALREADY COVERED and produces nothing (invariant 6).
 *
 * A rate rather than "any run at all": one unrelated filter firing once on one
 * of forty threads does not mean the group is handled, and treating it that way
 * would silently blind the miner to whole senders.
 */
export const ALREADY_FILTERED_RATE = 0.5

/**
 * Cards per inbox. An inbox-hygiene feature that presents forty cards is itself
 * inbox clutter (invariant 12). Enforced across runs, not just within one —
 * see {@link pruneStaleMailSuggestions}.
 */
export const MAX_SUGGESTIONS_PER_INBOX = 5

/** Groups pulled back from one inbox's statement — bounds memory, not behaviour. */
const GROUP_SCAN_LIMIT = 200

// ═══════════════════════════════════════════════════════════════════════════
// THE GROUPED QUERY (§5.1)
// ═══════════════════════════════════════════════════════════════════════════

/** One bulk-mail group in one inbox, as the statement below returns it. */
export interface MailGroupStats {
  subjectKey: string
  listId: string | null
  senderDomain: string | null
  messageCount: number
  threadCount: number
  /** Threads at least one qualifying member has read (the owner, for a personal inbox). */
  readThreadCount: number
  /** Threads archived by hand — archived AND with no MailFilterRun. */
  manualArchivedThreadCount: number
  /** Threads an existing filter fired on. */
  filteredThreadCount: number
  everReplied: boolean
  senderAuthenticated: boolean
  unsubscribeMeta: MailUnsubscribeMeta | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  sampleThreadIds: string[]
  topTagId: string | null
  topTagThreadCount: number
  topAssigneeId: string | null
  topAssigneeThreadCount: number
}

/** What {@link buildInboxGroupQuery} needs to scope one inbox's sweep. */
export interface InboxGroupQueryParams {
  organizationId: string
  inboxId: string
  /**
   * Whose read state counts. A PERSONAL inbox passes its owner, so "unread"
   * means the owner never opened it. A SHARED inbox passes `null`, and unread
   * means NO MEMBER has read it — `ThreadReadStatus` is unique on
   * `(threadId, userId)`, so a five-member mailbox has five answers to "did
   * anyone read this" and the only safe org-level reading is the union.
   */
  readerUserId: string | null
  /** Oldest message that counts. Bound as a timestamp, never as day arithmetic. */
  since: Date
}

/**
 * The one indexed grouped statement (§5.1, S8).
 *
 * ```
 * group by (inbox, coalesce('list:' || listId, 'domain:' || senderDomain)) →
 *   messageCount, threadCount, unreadRate, everReplied,
 *   manualArchiveRate (minus threads a MailFilterRun touched),
 *   latest unsubscribeMeta, senderAuthenticated
 * ```
 *
 * Three things in here are load-bearing rather than incidental:
 *
 * 1. **`per_thread` collapses to ONE ROW PER THREAD before any rate is taken.**
 *    A newsletter thread with 12 messages must count once toward `threadCount`,
 *    not twelve times; aggregating rates straight off `Message` would weight
 *    chatty threads into every ratio.
 * 2. **`manual_archived` excludes threads with a `MailFilterRun`** (§1.2,
 *    invariant 6). Without it the job proposes a filter to do what a filter is
 *    already doing, every week, forever.
 * 3. **`bool_and` on `senderAuthenticated`, not `bool_or`.** NULL means unknown
 *    and must read as "not authenticated" (invariant 3); requiring every message
 *    in the window to have passed is the conservative branch Outlook/IMAP
 *    history lands in until the header backfill catches up (§2.3), and the
 *    consequence — an archive suggestion instead of an unsubscribe one — is the
 *    right one.
 *
 * Exported so a test can read the emitted SQL: the `MailFilterRun` exclusion is
 * invisible to any assertion made on the returned rows alone.
 */
export function buildInboxGroupQuery(params: InboxGroupQueryParams): SQL {
  const { organizationId, inboxId, readerUserId, since } = params

  // A shared inbox has no single reader: "read" is "any member read it".
  const readerClause = readerUserId ? sql`AND rs."userId" = ${readerUserId}` : sql``

  return sql`
    WITH per_thread AS (
      SELECT
        COALESCE('list:' || m."listId", 'domain:' || m."senderDomain") AS subject_key,
        m."listId" AS list_id,
        m."senderDomain" AS sender_domain,
        t.id AS thread_id,
        count(*)::int AS message_count,
        min(m."createdAt") AS first_at,
        max(m."createdAt") AS last_at,
        bool_and(m."senderAuthenticated" IS TRUE) AS sender_authenticated,
        (array_agg(m."unsubscribeMeta" ORDER BY m."createdAt" DESC)
           FILTER (WHERE m."unsubscribeMeta" IS NOT NULL))[1] AS unsubscribe_meta,
        (t."repliedAt" IS NOT NULL) AS ever_replied,
        (t."status" = 'ARCHIVED') AS archived,
        t."assigneeId" AS assignee_id,
        EXISTS (
          SELECT 1 FROM "MailFilterRun" r
          WHERE r."organizationId" = ${organizationId} AND r."threadId" = t.id
        ) AS filtered,
        EXISTS (
          SELECT 1 FROM "ThreadReadStatus" rs
          WHERE rs."threadId" = t.id AND rs."isRead" = true ${readerClause}
        ) AS read_by_reader
      FROM "Message" m
      JOIN "Thread" t ON t.id = m."threadId"
      WHERE m."organizationId" = ${organizationId}
        AND t."inboxId" = ${inboxId}
        AND t."mergedIntoThreadId" IS NULL
        AND m."isInbound" = true
        AND m."createdAt" >= ${since}
        AND (m."listId" IS NOT NULL OR m."senderDomain" IS NOT NULL)
      GROUP BY 1, 2, 3, 4, t."repliedAt", t."status", t."assigneeId"
    ),
    per_group AS (
      SELECT
        subject_key,
        min(list_id) AS list_id,
        mode() WITHIN GROUP (ORDER BY sender_domain) AS sender_domain,
        sum(message_count)::int AS message_count,
        count(*)::int AS thread_count,
        count(*) FILTER (WHERE read_by_reader)::int AS read_thread_count,
        count(*) FILTER (WHERE archived AND NOT filtered)::int AS manual_archived_thread_count,
        count(*) FILTER (WHERE filtered)::int AS filtered_thread_count,
        bool_or(ever_replied) AS ever_replied,
        bool_and(sender_authenticated) AS sender_authenticated,
        min(first_at) AS first_seen_at,
        max(last_at) AS last_seen_at,
        (array_agg(unsubscribe_meta ORDER BY last_at DESC)
           FILTER (WHERE unsubscribe_meta IS NOT NULL))[1] AS unsubscribe_meta,
        (array_agg(thread_id ORDER BY last_at DESC))[1:3] AS sample_thread_ids
      FROM per_thread
      GROUP BY subject_key
    ),
    top_assignee AS (
      SELECT subject_key, assignee_id, cnt FROM (
        SELECT
          subject_key,
          assignee_id,
          count(*)::int AS cnt,
          row_number() OVER (PARTITION BY subject_key ORDER BY count(*) DESC, assignee_id) AS rn
        FROM per_thread
        WHERE assignee_id IS NOT NULL
        GROUP BY subject_key, assignee_id
      ) ranked WHERE rn = 1
    ),
    top_tag AS (
      SELECT subject_key, tag_id, cnt FROM (
        SELECT
          pt.subject_key AS subject_key,
          fv."relatedEntityId" AS tag_id,
          count(DISTINCT pt.thread_id)::int AS cnt,
          row_number() OVER (
            PARTITION BY pt.subject_key
            ORDER BY count(DISTINCT pt.thread_id) DESC, fv."relatedEntityId"
          ) AS rn
        FROM per_thread pt
        JOIN "FieldValue" fv ON fv."entityId" = pt.thread_id
        JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE cf."systemAttribute" = 'thread_tags'
          AND cf."organizationId" = ${organizationId}
          AND fv."relatedEntityId" IS NOT NULL
        GROUP BY pt.subject_key, fv."relatedEntityId"
      ) ranked WHERE rn = 1
    )
    SELECT
      g.*,
      ta.assignee_id AS top_assignee_id,
      ta.cnt AS top_assignee_thread_count,
      tt.tag_id AS top_tag_id,
      tt.cnt AS top_tag_thread_count
    FROM per_group g
    LEFT JOIN top_assignee ta ON ta.subject_key = g.subject_key
    LEFT JOIN top_tag tt ON tt.subject_key = g.subject_key
    WHERE g.message_count >= ${MIN_MESSAGES}
      AND g.thread_count >= ${MIN_THREADS}
    ORDER BY g.message_count DESC
    LIMIT ${GROUP_SCAN_LIMIT}
  `
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Normalize one raw statement row into {@link MailGroupStats}. */
export function toMailGroupStats(row: Record<string, unknown>): MailGroupStats {
  return {
    subjectKey: String(row.subject_key),
    listId: (row.list_id as string | null) ?? null,
    senderDomain: (row.sender_domain as string | null) ?? null,
    messageCount: asNumber(row.message_count),
    threadCount: asNumber(row.thread_count),
    readThreadCount: asNumber(row.read_thread_count),
    manualArchivedThreadCount: asNumber(row.manual_archived_thread_count),
    filteredThreadCount: asNumber(row.filtered_thread_count),
    everReplied: row.ever_replied === true,
    senderAuthenticated: row.sender_authenticated === true,
    unsubscribeMeta: (row.unsubscribe_meta as MailUnsubscribeMeta | null) ?? null,
    firstSeenAt: asDate(row.first_seen_at),
    lastSeenAt: asDate(row.last_seen_at),
    sampleThreadIds: Array.isArray(row.sample_thread_ids)
      ? (row.sample_thread_ids as string[]).filter(Boolean)
      : [],
    topTagId: (row.top_tag_id as string | null) ?? null,
    topTagThreadCount: asNumber(row.top_tag_thread_count),
    topAssigneeId: (row.top_assignee_id as string | null) ?? null,
    topAssigneeThreadCount: asNumber(row.top_assignee_thread_count),
  }
}

/** Run one inbox's grouped statement. Throws on a DB error; the caller wraps. */
export async function queryInboxGroups(
  db: Database,
  params: InboxGroupQueryParams
): Promise<MailGroupStats[]> {
  const result = await db.execute(buildInboxGroupQuery(params))
  const rows = (result?.rows ?? []) as Record<string, unknown>[]
  return rows.map(toMailGroupStats)
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DECISION LAYER (§5.2 / §5.3) — pure, so every rule is unit-testable
// ═══════════════════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000

/** Days between a group's oldest and newest message inside the window. */
export function historyDaysOf(group: MailGroupStats): number {
  if (!group.firstSeenAt || !group.lastSeenAt) return 0
  return Math.max(0, (group.lastSeenAt.getTime() - group.firstSeenAt.getTime()) / DAY_MS)
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return numerator / denominator
}

/**
 * The condition rows a suggestion prefills into the filter dialog, in
 * preference order.
 *
 * `list is <listId>` first: it is the STABLE identity that survives VERP and
 * per-campaign from-addresses. `senderDomain is <domain>` next, and
 * `from contains @<domain>` last — a substring match on the address, which is
 * what existed before the two columns landed.
 *
 * Only fields the filter catalog actually offers are considered
 * ({@link getMailFilterFields}); the compile check below is what makes that
 * safe rather than merely tidy.
 */
function candidateConditions(group: MailGroupStats): ConditionGroup[][] {
  const offered = new Set(getMailFilterFields().map((f) => f.id))
  const candidates: ConditionGroup[][] = []

  // `Condition.value` is REQUIRED, so a valueless operator (`empty`) still has to
  // carry the key — omitting it conditionally makes the property optional and no
  // longer assignable to `Condition[]`. `''` is what the condition editor itself
  // produces for those operators, and `buildListQuery` ignores the value for
  // `empty`/`not empty` entirely.
  const groupOf = (
    conditions: Array<{ fieldId: string; operator: string; value?: string }>
  ): ConditionGroup[] => [
    {
      id: 'g1',
      logicalOperator: 'AND',
      conditions: conditions.map((c, i) => ({
        id: `c${i + 1}`,
        fieldId: c.fieldId,
        operator: c.operator as Condition['operator'],
        value: c.value ?? '',
      })),
    },
  ]

  // A DOMAIN group is `listId IS NULL AND senderDomain = d` — that is what
  // `COALESCE('list:' || listId, 'domain:' || senderDomain)` means: mail carrying a
  // list id belongs to its OWN list group, never to the domain fallback. So the
  // filter must carry the `list is empty` half too, or it acts on strictly more mail
  // than the evidence was computed from: stripe.com sending both a newsletter
  // (`list-id: news.stripe.com`) and list-less receipts produces two groups, and a
  // bare `senderDomain is stripe.com` accepted from the receipts card would also
  // archive the newsletter — including one the user reads, since `everReplied` and
  // the unread rate are evaluated PER GROUP and the newsletter's numbers never
  // reached this card. Thread-level `list is empty` (no message in the thread carries
  // a list id) is the narrowing form, and narrowing is the safe direction.
  const listEmpty = offered.has('list') ? [{ fieldId: 'list', operator: 'empty' }] : []

  if (group.listId && offered.has('list')) {
    candidates.push(groupOf([{ fieldId: 'list', operator: 'is', value: group.listId }]))
  }
  if (group.senderDomain && offered.has('senderDomain')) {
    candidates.push(
      groupOf([
        { fieldId: 'senderDomain', operator: 'is', value: group.senderDomain },
        ...listEmpty,
      ])
    )
  }
  if (group.senderDomain && offered.has('from')) {
    candidates.push(
      groupOf([
        { fieldId: 'from', operator: 'contains', value: `@${group.senderDomain}` },
        ...listEmpty,
      ])
    )
  }
  return candidates
}

/**
 * Pick the first candidate condition set that COMPILES, or `null`.
 *
 * ⚠️ This is the check that keeps the feature from being dangerous.
 * `buildConditionGroupsQuery` DROPS a condition it cannot dispatch **silently**,
 * and a filter whose every condition dropped reduces to the bare org scope —
 * i.e. it matches every thread in the inbox (mail-filters invariant 19). The
 * router rejects such a save, so an uncompilable proposal would also be a card
 * that errors the moment a user clicks accept. Validating HERE, when the job
 * writes the row, is the difference between "we never offered it" and "we
 * offered you a rule that archives your entire mailbox".
 */
export function resolveProposedConditions(
  group: MailGroupStats,
  organizationId: string
): ConditionGroup[] | null {
  for (const candidate of candidateConditions(group)) {
    try {
      assertFilterConditionsCompile(candidate, organizationId)
      return candidate
    } catch (error) {
      logger.warn('Skipping mail-suggestion condition candidate that does not compile', {
        organizationId,
        subjectKey: group.subjectKey,
        fieldId: candidate[0]?.conditions[0]?.fieldId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return null
}

/** The filter a suggestion would create, per kind. Never includes an unsubscribe action. */
function proposedActionsFor(kind: MailSuggestionKind, group: MailGroupStats): MailFilterAction[] {
  switch (kind) {
    // Unsubscribe ALWAYS pairs with a filter (S10): senders take days to honour
    // a request and some ignore it, so the archive is the part that works
    // immediately. The unsubscribe itself is a one-shot command executed
    // outside the filter engine — never a MailFilterAction (invariant 1).
    case 'unsubscribe':
    case 'auto-archive':
      return [{ type: 'suppress-automations' }, { type: 'set-status', status: 'ARCHIVED' }]
    case 'auto-tag':
      return group.topTagId ? [{ type: 'add-tag', tagIds: [group.topTagId] }] : []
    case 'auto-assign':
      return group.topAssigneeId ? [{ type: 'assign', assigneeId: group.topAssigneeId }] : []
    default:
      return []
  }
}

/** What {@link buildMailSuggestionDrafts} needs beyond the groups themselves. */
export interface BuildDraftsParams {
  organizationId: string
  inboxId: string
  /** The card's owner: the inbox owner for a personal inbox, `null` org-level. */
  userId: string | null
  groups: MailGroupStats[]
  /** Dismissed + accepted subjectKeys for this inbox (suppression rules 2/3). */
  suppressedSubjectKeys: Set<string>
}

/**
 * Turn one inbox's groups into at most {@link MAX_SUGGESTIONS_PER_INBOX} cards.
 *
 * Suppression, in the order it is applied — the first rule is the most
 * important one in the whole feature:
 *
 * 1. **`everReplied` ⇒ nothing, ever, for that subjectKey** (invariant 5). A
 *    human replied once; that is not noise, and no volume of unread mail
 *    afterwards makes it noise.
 * 2. **Already covered by a filter ⇒ nothing** (invariant 6) — otherwise the
 *    job proposes a filter to do what a filter already does, weekly, forever.
 * 3. **Dismissed (or accepted) ⇒ nothing** (invariant 7).
 * 4. **Cap at five per inbox, ranked by `messageCount × unreadRate`**
 *    (invariant 12).
 *
 * Pure: no database, no clock beyond the group's own timestamps. Everything a
 * reviewer needs to check about this feature's behaviour is checkable here.
 */
export function buildMailSuggestionDrafts(params: BuildDraftsParams): MailSuggestionDraft[] {
  const { organizationId, inboxId, userId, groups, suppressedSubjectKeys } = params
  const drafts: MailSuggestionDraft[] = []

  for (const group of groups) {
    // Rule 1 — one reply ever kills every suggestion for this sender, forever.
    if (group.everReplied) continue
    // Rule 3 — a decision the user already made.
    if (suppressedSubjectKeys.has(group.subjectKey)) continue
    // Rule 2 — an existing filter is already handling this group.
    if (rate(group.filteredThreadCount, group.threadCount) >= ALREADY_FILTERED_RATE) continue

    // Volume + history floors.
    if (group.messageCount < MIN_MESSAGES) continue
    if (group.threadCount < MIN_THREADS) continue
    const historyDays = historyDaysOf(group)
    if (historyDays < MIN_HISTORY_DAYS) continue

    const unreadRate = 1 - rate(group.readThreadCount, group.threadCount)
    const manualArchiveRate = rate(group.manualArchivedThreadCount, group.threadCount)
    const unsubscribeMethod = resolveUnsubscribeMethod(group.unsubscribeMeta)

    const conditions = resolveProposedConditions(group, organizationId)
    if (!conditions) {
      logger.warn('Skipping mail suggestion: no proposed condition compiles', {
        organizationId,
        inboxId,
        subjectKey: group.subjectKey,
      })
      continue
    }

    const baseEvidence: MailSuggestionEvidence = {
      windowDays: SUGGESTION_WINDOW_DAYS,
      messageCount: group.messageCount,
      threadCount: group.threadCount,
      unreadRate,
      manualArchiveRate,
      everReplied: false,
      sampleThreadIds: group.sampleThreadIds,
      unsubscribeMethod,
      listId: group.listId,
      senderDomain: group.senderDomain,
      senderAuthenticated: group.senderAuthenticated,
      historyDays: Math.round(historyDays),
      filteredThreadCount: group.filteredThreadCount,
    }

    // ── The unsubscribe safety gate (§6.2, invariants 3/4) ──────────────────
    // No `listId` AND not authenticated ⇒ NEVER offer unsubscribe: replying to
    // an unverified sender's unsubscribe confirms a live address. `NULL` counts
    // as NOT authenticated, which is why `senderAuthenticated` is a plain
    // boolean here and the SQL collapses unknown to false. A sender that
    // published no usable header is the same case — there is nothing to click.
    const unsubscribeOfferable =
      unreadRate >= UNREAD_RATE_THRESHOLD &&
      unsubscribeMethod !== null &&
      (group.listId !== null || group.senderAuthenticated)

    const kinds: MailSuggestionKind[] = []
    if (unsubscribeOfferable) {
      kinds.push('unsubscribe')
    } else if (
      unreadRate >= UNREAD_RATE_THRESHOLD ||
      manualArchiveRate >= MANUAL_ARCHIVE_RATE_THRESHOLD
    ) {
      // The "offer block/filter instead" branch of §6.2, and the ordinary
      // archive-by-hand proposal. One card per group either way.
      kinds.push('auto-archive')
    }

    const tagConsistency = rate(group.topTagThreadCount, group.threadCount)
    if (group.topTagId && tagConsistency >= CONSISTENCY_THRESHOLD) kinds.push('auto-tag')

    const assigneeConsistency = rate(group.topAssigneeThreadCount, group.threadCount)
    if (group.topAssigneeId && assigneeConsistency >= CONSISTENCY_THRESHOLD) {
      kinds.push('auto-assign')
    }

    for (const kind of kinds) {
      const actions = proposedActionsFor(kind, group)
      try {
        assertFilterShape({ name: group.subjectKey, actions })
      } catch (error) {
        logger.warn('Skipping mail suggestion whose proposed actions are not saveable', {
          organizationId,
          inboxId,
          subjectKey: group.subjectKey,
          kind,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      const evidence: MailSuggestionEvidence = { ...baseEvidence }
      if (kind === 'auto-tag') {
        evidence.consistency = tagConsistency
        evidence.tagId = group.topTagId ?? undefined
      }
      if (kind === 'auto-assign') {
        evidence.consistency = assigneeConsistency
        evidence.assigneeId = group.topAssigneeId ?? undefined
      }

      drafts.push({
        inboxId,
        userId,
        kind,
        subjectKey: group.subjectKey,
        evidence,
        proposedConditions: conditions,
        proposedActions: actions,
        score: group.messageCount * unreadRate,
      })
    }
  }

  // Rule 4 — rank, then cap. Ties break on volume then on the key, so a rerun
  // over unchanged data produces the same five cards rather than a shuffle.
  drafts.sort(
    (a, b) =>
      b.score - a.score ||
      b.evidence.messageCount - a.evidence.messageCount ||
      a.subjectKey.localeCompare(b.subjectKey) ||
      a.kind.localeCompare(b.kind)
  )
  return drafts.slice(0, MAX_SUGGESTIONS_PER_INBOX)
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SWEEP
// ═══════════════════════════════════════════════════════════════════════════

/** One inbox, as the miner needs to see it. Matches the `inboxes` org-cache shape. */
export interface MineableInbox {
  id: string
  isPersonal: boolean
  ownerUserId: string | null
}

/** Per-inbox outcome, summed into the job's stats. */
export interface MineInboxResult {
  inboxId: string
  groups: number
  written: number
  pruned: number
}

/**
 * Mine one inbox and reconcile its `new` cards.
 *
 * A PERSONAL inbox writes `userId = <owner>` — read rate is per user and the
 * card is that person's alone. A SHARED inbox writes `userId = NULL`, the
 * org-level row the `NULLS NOT DISTINCT` unique key exists for, and its unread
 * rate means "no member has read it".
 */
export async function mineInboxSuggestions(
  db: Database,
  organizationId: string,
  inbox: MineableInbox,
  now: Date = new Date()
): Promise<Result<MineInboxResult, Error>> {
  try {
    return await mineInbox(db, organizationId, inbox, now)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

async function mineInbox(
  db: Database,
  organizationId: string,
  inbox: MineableInbox,
  now: Date
): Promise<Result<MineInboxResult, Error>> {
  const userId = inbox.isPersonal ? inbox.ownerUserId : null
  if (inbox.isPersonal && !userId) {
    // A personal mailbox with no owner has nobody to address a card to, and its
    // read state cannot be resolved. Skipping is the only correct answer.
    return ok({ inboxId: inbox.id, groups: 0, written: 0, pruned: 0 })
  }

  const suppressed = await listSuppressedSubjectKeys(db, organizationId, inbox.id)
  if (suppressed.isErr()) return err(suppressed.error)

  const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * DAY_MS)
  const groups = await queryInboxGroups(db, {
    organizationId,
    inboxId: inbox.id,
    readerUserId: userId,
    since,
  })

  const drafts = buildMailSuggestionDrafts({
    organizationId,
    inboxId: inbox.id,
    userId,
    groups,
    suppressedSubjectKeys: suppressed.value,
  })

  const written = await upsertMailSuggestions(db, organizationId, drafts)
  if (written.isErr()) return err(written.error)

  const pruned = await pruneStaleMailSuggestions(db, organizationId, {
    inboxId: inbox.id,
    userId,
    keepSubjectKeys: [...new Set(drafts.map((d) => d.subjectKey))],
  })
  if (pruned.isErr()) return err(pruned.error)

  return ok({
    inboxId: inbox.id,
    groups: groups.length,
    written: written.value,
    pruned: pruned.value,
  })
}

/** Org-level sweep totals. */
export interface MineOrganizationResult {
  inboxes: number
  groups: number
  written: number
  pruned: number
}

/**
 * Mine every inbox in one org.
 *
 * The inbox list comes from the `inboxes` org-cache key (both definitions,
 * merged) rather than a fresh join — it is exactly what
 * `CLAUDE.md`'s org-cache rule is about, and the personal/owner discriminator
 * lives there already. Reached through a lazy `await import('../cache')` for the
 * same reason `mail-filters/cache.ts` does: the barrel drags the workflow-app
 * cache — and therefore the workflow engine — into every importer's graph.
 *
 * One inbox's failure never stops the org: a mailbox with an unusual shape must
 * not cost every other mailbox its suggestions.
 */
export async function mineOrganizationSuggestions(
  db: Database,
  organizationId: string,
  now: Date = new Date()
): Promise<Result<MineOrganizationResult, Error>> {
  const { getOrgCache } = await import('../cache')
  const inboxes = (await getOrgCache().get(organizationId, 'inboxes')) as MineableInbox[]

  const totals: MineOrganizationResult = { inboxes: 0, groups: 0, written: 0, pruned: 0 }
  for (const inbox of inboxes) {
    const result = await mineInboxSuggestions(db, organizationId, inbox, now)
    totals.inboxes++
    if (result.isErr()) {
      logger.warn('Mail-suggestion mining failed for one inbox', {
        organizationId,
        inboxId: inbox.id,
        error: result.error.message,
      })
      continue
    }
    totals.groups += result.value.groups
    totals.written += result.value.written
    totals.pruned += result.value.pruned
  }

  return ok(totals)
}
