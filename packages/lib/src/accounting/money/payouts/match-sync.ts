// packages/lib/src/accounting/money/payouts/match-sync.ts

/**
 * The reconcile's match pass: load a payout's `ProcessorBalanceEntry` rows, ask
 * the matcher, and store the answer under the freeze rule
 * (`plans/accounting/payout-links.md` §9.1, §9.3).
 *
 * Split out of `assess-payouts.ts` because it works on ROWS while the assessment
 * around it works on observation envelopes; the two never share a key.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import { findLinkedPostings } from '../../ledger/reads/list-postings'
import { readSourceAccounts } from '../customer-money/source-reads'
import { type PayoutSplit, type StoredPayoutEntry, splitStoredEntries } from './client'
import { listPayoutEntries } from './entry-reads'
import {
  assessProcessorEntries,
  MATCHABLE_ENTRY_TYPES,
  type MatchableProcessorEntry,
} from './match-entries'
import { MATCH_STATE_FOR_REASON, type MatchReason, type MatchState } from './match-reasons'
import { resolveEntryReferences, type UnreferencedEntry } from './reference-resolvers'

/** One payout's items, addressed the way `ProcessorBalanceEntry_payout_idx` indexes them. */
export interface PayoutEntryScope {
  /** The caller's own handle for this payout — a `MoneyTransfer.id` in the reconcile. */
  key: string
  sourceAccountId: string
  payoutExternalId: string
}

/** What the stored columns say about one payout, after this pass wrote them. */
export interface StoredMatchSummary {
  /**
   * The basis-hash input, sorted and taken from the STORED columns so a repeated
   * assessment agrees with the last one instead of churning (§3.5).
   */
  basis: Array<[string, MatchState, string | null, MatchReason | null]>
  /** `pending` + `suggested` + `unmatchable` — everything that is not settled. */
  unmatchedCount: number
  /** The split the posting should carry, from the stored match (§11.3). */
  split: PayoutSplit
  /** Non-outgoing rows this payout has. Zero means the feed has no evidence for it. */
  entryCount: number
  /**
   * Live payout postings whose `unidentified_receipts` credit no longer equals
   * what the stored match says is unrecognised — the T26 re-post trigger (§13 Q6).
   * The caller reverses them AFTER its transaction; the sweep re-posts.
   */
  stalePostingIds: string[]
}

type StoredPayoutEntryRow = StoredPayoutEntry & { glPostingId: string | null }

type Stored = {
  matchState: MatchState | null
  matchedMoneyTransactionId: string | null
  matchReason: MatchReason | null
}

/**
 * Which of these items a live (non-reversed) posting names as a member.
 *
 * The §9.1 predicate in one query: `matched` and `unmatchable` rows named by a
 * live posting are never rewritten, and reversing the posting unfreezes them.
 */
export async function readFrozenEntryIds(
  db: Database | Transaction,
  organizationId: string,
  entryIds: readonly string[]
): Promise<Set<string>> {
  return new Set((await readLivePostingsByEntry(db, organizationId, entryIds)).keys())
}

/** The same query, keeping the posting each frozen item is named by. */
async function readLivePostingsByEntry(
  db: Database | Transaction,
  organizationId: string,
  entryIds: readonly string[]
): Promise<Map<string, string>> {
  const rows = await findLinkedPostings(db, organizationId, {
    sourceKind: 'processor_balance_entry',
    sourceIds: entryIds,
    linkRole: 'member',
    statuses: ['posted'],
  })
  return new Map(rows.map((row) => [row.sourceId, row.glPostingId]))
}

/**
 * What each of these postings credited to `unidentified_receipts`, in minor
 * units. Absent means the entry dropped the leg, which is zero.
 */
async function readUnrecognisedCredits(
  db: Database | Transaction,
  organizationId: string,
  glPostingIds: readonly string[]
): Promise<Map<string, number>> {
  if (!glPostingIds.length) return new Map()
  const rows = await db
    .select({
      glPostingId: schema.GlPostingLine.glPostingId,
      amountMinor: schema.GlPostingLine.amountMinor,
    })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        inArray(schema.GlPostingLine.glPostingId, [...new Set(glPostingIds)]),
        eq(schema.GlPostingLine.accountRole, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS),
        eq(schema.GlPostingLine.direction, 'credit')
      )
    )
  const byPosting = new Map<string, number>()
  for (const row of rows)
    byPosting.set(row.glPostingId, (byPosting.get(row.glPostingId) ?? 0) + row.amountMinor)
  return byPosting
}

/**
 * The refund movements whose live posting already books a dispute fee (91 D8). A chargeback
 * matched before its refund posted carries the fee there; one matched after leaves it to the
 * payout, so each fee lands exactly once whatever arrived first.
 */
async function readRefundsCarryingFee(
  db: Database | Transaction,
  organizationId: string,
  moneyTransactionIds: readonly string[]
): Promise<Set<string>> {
  if (!moneyTransactionIds.length) return new Set()
  const rows = await db
    .selectDistinct({ sourceId: schema.GlPostingLine.sourceId })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.sourceType, 'money_transaction'),
        inArray(schema.GlPostingLine.sourceId, [...new Set(moneyTransactionIds)]),
        eq(schema.GlPostingLine.accountRole, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES),
        eq(schema.GlPosting.status, 'posted')
      )
    )
  return new Set(rows.map((row) => row.sourceId))
}

/** A stored answer this pass may overwrite. */
function rewritable(row: Stored & { matchedBy: string | null }, frozen: boolean): boolean {
  // A person's answer outranks the matcher's whether or not a posting has
  // claimed it yet - otherwise a manual match made before posting would be
  // silently undone by the next reconcile, which is every reconcile.
  if (row.matchedBy) return false
  if (!frozen) return true
  return row.matchState === 'pending' || row.matchState === 'suggested' || row.matchState === null
}

/**
 * Match every item of these payouts and store what changed, in the caller's
 * transaction. One `UPDATE` per changed row; unchanged rows are not touched.
 */
export async function syncStoredMatches(
  tx: Transaction,
  organizationId: string,
  payouts: readonly PayoutEntryScope[]
): Promise<Map<string, StoredMatchSummary>> {
  const emptySummary = (): StoredMatchSummary => ({
    basis: [],
    unmatchedCount: 0,
    split: splitStoredEntries([]),
    entryCount: 0,
    stalePostingIds: [],
  })
  const summaries = new Map<string, StoredMatchSummary>(
    payouts.map((payout) => [payout.key, emptySummary()])
  )
  const scopes = payouts.filter((payout) => payout.payoutExternalId)
  if (!scopes.length) return summaries

  // 🛑 Every non-outgoing row, not only the matchable ones: the SPLIT is this
  // function's second answer (§11.3) and a fee or an adjustment is part of it,
  // unrecognised by construction. Only `charge`, `refund` and `dispute` reach the matcher.
  const allRows = await listPayoutEntries(tx, organizationId, scopes)
  const keyByScope = new Map(
    scopes.map((scope) => [`${scope.sourceAccountId}:${scope.payoutExternalId}`, scope.key])
  )
  const keyOf = (row: { sourceAccountId: string; payoutExternalId: string | null }) =>
    keyByScope.get(`${row.sourceAccountId}:${row.payoutExternalId}`)
  if (!allRows.length) return summaries

  const rows = allRows.filter((row) => MATCHABLE_ENTRY_TYPES.includes(row.type))
  const accounts = await readSourceAccounts(
    tx,
    organizationId,
    allRows.map((row) => row.sourceAccountId)
  )
  const providerByAccount = new Map([...accounts].map(([id, row]) => [id, row.providerKey]))

  const unreferenced = new Map<string, UnreferencedEntry[]>()
  for (const row of rows) {
    if (row.sourceReference) continue
    const providerKey = providerByAccount.get(row.sourceAccountId)
    if (!providerKey) continue
    const list = unreferenced.get(providerKey) ?? []
    list.push({
      id: row.id,
      sourceAccountId: row.sourceAccountId,
      type: row.type,
      sourceTransactionId: row.sourceTransactionId,
      sourceId: row.sourceId,
      sourceOrderId: row.sourceOrderId,
    })
    unreferenced.set(providerKey, list)
  }
  const resolved = await resolveEntryReferences(tx, organizationId, unreferenced)

  const matchable: MatchableProcessorEntry[] = rows.map((row) => ({
    id: row.id,
    sourceAccountId: row.sourceAccountId,
    sourceReference: row.sourceReference ?? resolved.get(row.id) ?? null,
    type: row.type,
    grossMinor: row.grossMinor,
    currency: row.currency,
    currencyExponent: row.currencyExponent,
  }))
  const outcome = await assessProcessorEntries(tx, organizationId, matchable)
  const livePostings = await readLivePostingsByEntry(
    tx,
    organizationId,
    allRows.map((row) => row.id)
  )

  const now = new Date().toISOString()
  const changed: Array<ReturnType<typeof sql>> = []
  /** The state this pass leaves on each row, matchable or not, for the split. */
  const stateById = new Map<string, MatchState | null>()
  const matchedMoneyById = new Map<string, string>()
  for (const row of rows) {
    const matched = outcome.matches.get(row.id)
    const refusal = outcome.refusals.get(row.id)
    const computed: Stored = matched
      ? { matchState: 'matched', matchedMoneyTransactionId: matched, matchReason: null }
      : refusal
        ? {
            matchState: MATCH_STATE_FOR_REASON[refusal.reason],
            matchedMoneyTransactionId:
              'candidateMoneyTransactionId' in refusal ? refusal.candidateMoneyTransactionId : null,
            matchReason: refusal.reason,
          }
        : { matchState: 'pending', matchedMoneyTransactionId: null, matchReason: 'no_receipt' }
    const next = rewritable(row, livePostings.has(row.id))
      ? computed
      : {
          matchState: row.matchState,
          matchedMoneyTransactionId: row.matchedMoneyTransactionId,
          matchReason: row.matchReason,
        }
    if (
      next.matchState !== row.matchState ||
      next.matchedMoneyTransactionId !== row.matchedMoneyTransactionId ||
      next.matchReason !== row.matchReason
    )
      changed.push(
        sql`(${row.id}::text, ${next.matchState}::text, ${next.matchedMoneyTransactionId}::text, ${next.matchReason}::text, ${
          next.matchState === 'matched' || next.matchState === 'suggested' ? now : null
        }::timestamptz)`
      )
    stateById.set(row.id, next.matchState)
    if (next.matchedMoneyTransactionId) matchedMoneyById.set(row.id, next.matchedMoneyTransactionId)
    const summary = summaries.get(keyOf(row) ?? '')
    if (!summary) continue
    summary.basis.push([
      row.id,
      next.matchState ?? 'pending',
      next.matchedMoneyTransactionId,
      next.matchReason,
    ])
    if (next.matchState !== 'matched') summary.unmatchedCount++
  }
  // One statement for the whole batch, not one per row: the reconcile's query
  // count has to stay flat across a chunk (`record-reconciliation.int.test.ts`),
  // and `record-storage.ts` already corrects rows this way.
  if (changed.length)
    await tx.execute(
      sql`UPDATE ${schema.ProcessorBalanceEntry} AS entry SET "matchState" = next.match_state, "matchedMoneyTransactionId" = next.matched_money, "matchReason" = next.match_reason, "matchedAt" = next.matched_at FROM (VALUES ${sql.join(changed, sql`,`)}) AS next(id, match_state, matched_money, match_reason, matched_at) WHERE entry."organizationId" = ${organizationId} AND entry.id = next.id`
    )
  for (const summary of summaries.values()) summary.basis.sort()

  // ── The split, and the postings it makes stale (§11.3, §13 Q6) ────────────
  const matchedDisputeMoney = rows.flatMap((row) => {
    const money = matchedMoneyById.get(row.id)
    return row.type === 'dispute' && stateById.get(row.id) === 'matched' && money ? [money] : []
  })
  const feeOnRefund = await readRefundsCarryingFee(tx, organizationId, matchedDisputeMoney)
  const entriesByKey = new Map<string, StoredPayoutEntryRow[]>()
  for (const row of allRows) {
    const key = keyOf(row)
    if (!key) continue
    const list = entriesByKey.get(key) ?? []
    const money = matchedMoneyById.get(row.id)
    list.push({
      type: row.type,
      matchState: stateById.get(row.id) ?? row.matchState,
      grossMinor: Number(row.grossMinor),
      feeMinor: Number(row.feeMinor),
      netMinor: Number(row.netMinor),
      ...(money && feeOnRefund.has(money) ? { feeOnRefund: true } : {}),
      glPostingId: livePostings.get(row.id) ?? null,
    })
    entriesByKey.set(key, list)
  }
  const unrecognisedCredits = await readUnrecognisedCredits(tx, organizationId, [
    ...new Set([...livePostings.values()]),
  ])
  for (const [key, entries] of entriesByKey) {
    const summary = summaries.get(key)
    if (!summary) continue
    summary.entryCount = entries.length
    summary.split = splitStoredEntries(entries)
    // 🛑 Stale is a COMPARISON, never "an item just became matched". A payout
    // that still holds one pending item would otherwise be reversed on every
    // pass forever, because its posting keeps a remainder either way. The
    // posting is wrong exactly when the remainder it credited is no longer the
    // remainder the stored match adds up to.
    for (const glPostingId of new Set(
      entries.flatMap((entry) => (entry.glPostingId ? [entry.glPostingId] : []))
    )) {
      const credited = unrecognisedCredits.get(glPostingId) ?? 0
      if (credited > 0 && credited !== summary.split.unrecognisedNetMinor)
        summary.stalePostingIds.push(glPostingId)
    }
  }
  return summaries
}

/**
 * The `MoneyTransfer`s holding an item the matcher has not settled, by
 * organization — the pending-only sweep (§9.2), one query on the partial index.
 * `organizationId` narrows it to one org (the Payouts page's re-check).
 */
export async function listTransfersWithOpenMatches(
  db: Database,
  options: { limit?: number; organizationId?: string } = {}
): Promise<Map<string, string[]>> {
  const query = db
    .selectDistinct({
      organizationId: schema.MoneyTransfer.organizationId,
      id: schema.MoneyTransfer.id,
    })
    .from(schema.ProcessorBalanceEntry)
    .innerJoin(
      schema.MoneyTransfer,
      and(
        eq(schema.MoneyTransfer.organizationId, schema.ProcessorBalanceEntry.organizationId),
        eq(schema.MoneyTransfer.sourceAccountId, schema.ProcessorBalanceEntry.sourceAccountId),
        eq(schema.MoneyTransfer.externalId, schema.ProcessorBalanceEntry.payoutExternalId)
      )
    )
    // Not `unmatchable`: that state is a person's answer, never retried by a sweep.
    .where(
      and(
        inArray(schema.ProcessorBalanceEntry.matchState, ['pending', 'suggested']),
        options.organizationId
          ? eq(schema.ProcessorBalanceEntry.organizationId, options.organizationId)
          : undefined
      )
    )
    .orderBy(schema.MoneyTransfer.organizationId, schema.MoneyTransfer.id)
    .$dynamic()
  const rows = await (options.limit ? query.limit(options.limit) : query)
  const byOrganization = new Map<string, string[]>()
  for (const row of rows) {
    const ids = byOrganization.get(row.organizationId) ?? []
    ids.push(row.id)
    byOrganization.set(row.organizationId, ids)
  }
  return byOrganization
}
