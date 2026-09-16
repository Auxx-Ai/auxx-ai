// apps/web/src/components/accounting/ui/ledger/sync-queue/sync-queue-rows.ts

import { type SyncQueueRow, type SyncQueueState, syncQueueState } from '@auxx/lib/postings/client'

/**
 * Everything about the sync queue that is a pure function of its rows: the
 * tally the rail renders, the tab vocabulary, and the sentence each state gets.
 *
 * 🔌 **No provider is named anywhere in this file.** Every sentence that would
 * say "QuickBooks" takes `providerLabel` instead, which the caller reads off
 * `useAccountingProviderStatus` and which falls back to
 * `UNKNOWN_PROVIDER_LABEL` when nothing is connected (decision D14a). The seam
 * is provider-agnostic and the copy has to be too.
 */

/** The tab set: the three real states plus "everything". */
export const SYNC_QUEUE_TABS = ['held', 'sending', 'failed', 'all'] as const
export type SyncQueueTab = (typeof SYNC_QUEUE_TABS)[number]

/**
 * 🛑 `held` and `sending` are BOTH `exportStatus: 'pending'` and they are two
 * tabs, not one. Once the hold is on, `pending` is the resting state of every
 * entry the organization posts; a single undifferentiated pile makes a perfectly
 * healthy hold look like forty things gone wrong (53 §7.2.2).
 *
 * The verb is **Sync**, so the tab that Sync acts on is named for being ready
 * for it rather than for the mechanism that is holding it.
 */
export const SYNC_QUEUE_TAB_LABELS: Record<SyncQueueTab, string> = {
  held: 'Ready to sync',
  sending: 'Sending',
  failed: 'Refused',
  all: 'All',
}

/** The dot vocabulary, matching `ledger-toolbar.tsx`'s `STATE_DOT`. */
export const SYNC_QUEUE_STATE_DOT: Record<SyncQueueState, string> = {
  held: 'bg-muted-foreground',
  sending: 'bg-blue-500',
  failed: 'bg-amber-500',
}

export interface SyncQueueTally {
  held: number
  sending: number
  failed: number
  total: number
}

/** Count each state once. `total` is every row the queue holds, all periods. */
export function tallySyncQueue(rows: SyncQueueRow[] | undefined): SyncQueueTally {
  const tally: SyncQueueTally = { held: 0, sending: 0, failed: 0, total: 0 }
  for (const row of rows ?? []) {
    tally[syncQueueState(row)]++
    tally.total++
  }
  return tally
}

/** The rows a tab shows. `all` filters nothing - it is the backlog itself. */
export function filterSyncQueue(rows: SyncQueueRow[], tab: SyncQueueTab): SyncQueueRow[] {
  if (tab === 'all') return rows
  return rows.filter((row) => syncQueueState(row) === tab)
}

/**
 * What one row's state MEANS, in one sentence.
 *
 * 🛑 `held` is deliberately not an apology and not an alarm. It is the state the
 * hold exists to produce, and copy that treated it as a backlog would teach
 * people that a working setting is a problem.
 */
export function syncQueueStateSentence(state: SyncQueueState, providerLabel: string): string {
  switch (state) {
    case 'held':
      return `In your books and held here. Nothing has been sent to ${providerLabel}; syncing is what sends it.`
    case 'sending':
      return `Released to ${providerLabel} and not acknowledged yet. Either in flight, or claimed by a run that stopped before it finished.`
    case 'failed':
      return `${providerLabel} refused it. The entry is still in your books - only the copy is outstanding.`
  }
}

/**
 * The one line the rail says under the button, or `null` when the queue is
 * empty and there is nothing to say.
 *
 * ⚠️ A rail line that renders every day says nothing, so an empty queue gets no
 * line at all rather than "0 entries waiting". Same reason the rail no longer
 * carries the balance sweep's standing answer: a figure that reads identically
 * every day teaches people to stop reading.
 */
export function syncQueueRailSentence(tally: SyncQueueTally, providerLabel: string): string | null {
  if (tally.total === 0) return null
  const parts: string[] = []
  if (tally.held > 0) parts.push(`${tally.held} ready to sync`)
  if (tally.sending > 0) parts.push(`${tally.sending} sending`)
  if (tally.failed > 0) parts.push(`${tally.failed} refused`)
  return `${parts.join(', ')} to ${providerLabel}.`
}

/**
 * What a row's warning icon says on hover, as lines.
 *
 * 🛑 **ONE icon, not two, even though these are two different facts from two
 * different moments.** `failureReason` is the provider's own refusal, persisted
 * on the posting; `sessionRefusal` is a PLAN refusal from the Sync you just
 * pressed, which never stamps `exportStatus: 'failed'` and therefore exists
 * nowhere but in this session's memory. Both can be true at once - a row the
 * provider refused last week, re-synced today, refused by
 * `assertCoveragePartitionsInTx` before it ever left. Two amber dots side by
 * side read as a rendering fault; one icon carrying both sentences reads as one
 * row with something to say.
 *
 * The in-session line comes FIRST: it describes the action the reader just took.
 *
 * 🔌 The provider is never named here either (D14a) - `providerLabel` arrives
 * from `useAccountingProviderStatus`. The refusal STRINGS are the provider's own
 * words and are passed through verbatim; the sentence around them is ours.
 */
export function refusalTooltipLines(
  row: Pick<SyncQueueRow, 'failureReason'>,
  sessionRefusal: string | undefined,
  providerLabel: string
): string[] {
  const lines: string[] = []
  if (sessionRefusal) lines.push(`The last sync did not release it. ${sessionRefusal}`)
  if (row.failureReason) lines.push(`${providerLabel} refused it. ${row.failureReason}`)
  return lines
}

/**
 * The refused entries in ONE sentence, for the ledger page's banner.
 *
 * 🔑 D17's own reasoning, applied to the banner. The sync queue is one list; a
 * banner that enumerates every refused row is a second list of the same rows,
 * and with 28 refusals it buries the ledger under 28 identical amber cards. The
 * banner's job is to say the count and point at the queue. So reasons are
 * SUMMARISED, never enumerated.
 *
 * ⚠️ The common case is one shared reason (a role nobody mapped refuses every
 * entry that uses it), and saying it once is strictly more useful than "1
 * distinct reason" - so a single shared reason is quoted. More than one becomes
 * a count, because the remedy is per row and the row is in the queue.
 */
export function refusedReasonSummary(rows: readonly Pick<SyncQueueRow, 'failureReason'>[]): string {
  const reasons = new Set<string>()
  for (const row of rows) {
    if (row.failureReason) reasons.add(row.failureReason)
  }
  if (reasons.size === 0) {
    return 'No reason was recorded. The sync queue shows where each one stands.'
  }
  if (reasons.size === 1) return [...reasons][0]!
  return `${reasons.size} different reasons, each on its own row in the sync queue.`
}

/** The distinct periods present in the queue, in the order the rows arrive. */
export function syncQueuePeriods(rows: SyncQueueRow[]): string[] {
  const seen: string[] = []
  for (const row of rows) {
    if (!seen.includes(row.periodKey)) seen.push(row.periodKey)
  }
  return seen
}
