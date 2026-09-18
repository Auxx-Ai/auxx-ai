// packages/lib/src/accounting/money/payouts/match-reasons.ts

/**
 * Why a processor item is not simply `matched`, as a fixed code the drawer keys
 * its copy and its one action off (`plans/accounting/payout-links.md` §10.4).
 *
 * 🛑 The union is mirrored on `ProcessorBalanceEntry.matchReason` in
 * `@auxx/database`, which cannot import `@auxx/lib`. Change both together.
 */

export const PROCESSOR_MATCH_REASONS = [
  /** No source object for the reference yet — the order or transaction has not synced. */
  'no_receipt',
  /** The item's feed has no `paymentGatewayId`, so every candidate is refused. */
  'no_rail',
  /** No `sourceReference` on the item and no resolver for its `providerKey`. */
  'no_reference',
  /** More than one candidate survived, or two failed different checks. */
  'ambiguous',
  /** One candidate matched the reference and rail; the amount did not. */
  'amount_differs',
  /** One candidate matched the reference; its account settles another rail. */
  'rail_differs',
  /** A person matched an item the matcher had no code for at all. */
  'manual',
] as const

export type MatchReason = (typeof PROCESSOR_MATCH_REASONS)[number]

export const PROCESSOR_MATCH_STATES = ['pending', 'suggested', 'matched', 'unmatchable'] as const

export type MatchState = (typeof PROCESSOR_MATCH_STATES)[number]

/** The state the matcher writes for a reason code; accept and manual match override it. */
export const MATCH_STATE_FOR_REASON: Record<MatchReason, MatchState> = {
  no_receipt: 'pending',
  no_rail: 'pending',
  no_reference: 'unmatchable',
  ambiguous: 'unmatchable',
  amount_differs: 'suggested',
  rail_differs: 'suggested',
  manual: 'matched',
}
