// apps/web/src/components/accounting/ui/banking/payouts/match-reason-copy.ts

// The §10.4 table as copy: one sentence and one next action per reason code.
// Shared by the drawer's item rows and the payouts list's dominant-code badge,
// so the worklist and the row cannot describe the same item differently.

import type { MatchReason, MatchState } from '@auxx/lib/accounting/money/payouts/client'
import type { Variant } from '@auxx/ui/components/badge'

export const MATCH_STATE_LABEL: Record<MatchState, string> = {
  pending: 'Pending',
  suggested: 'Suggested',
  matched: 'Matched',
  unmatchable: 'Unmatchable',
}

/**
 * `matched` is the only settled outcome, so it is the only green one. Amber for
 * the two a person can close in one click, outline for the two that are waiting
 * on another feed or on a decision — the tone scale `chart-list.tsx` uses.
 */
export const MATCH_STATE_VARIANT: Record<MatchState, Variant> = {
  pending: 'outline',
  suggested: 'amber',
  matched: 'green',
  unmatchable: 'secondary',
}

/** The badge word beside the state — short enough for a 380px drawer row. */
export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  no_receipt: 'No receipt yet',
  no_rail: 'Feed has no gateway',
  no_reference: 'No reference',
  ambiguous: 'Ambiguous',
  amount_differs: 'Amount differs',
  rail_differs: 'Gateway differs',
  manual: 'Matched by hand',
}

/** What happened, in the fixed words §10.4 assigns the code. */
export const MATCH_REASON_COPY: Record<MatchReason, string> = {
  no_receipt:
    'No customer payment has been recorded for this reference yet. The order or transaction has not synced.',
  no_rail:
    'This feed is not linked to a payment gateway, so every candidate receipt is refused. Link the feed to match it.',
  no_reference:
    'The provider sent no reference for this item and no resolver covers this source. Match it by hand.',
  ambiguous:
    'More than one customer payment fits this item, so the matcher refused all of them. Pick the right one.',
  amount_differs:
    'One receipt matches the reference and the gateway, but not the amount. Accept the difference or match by hand.',
  rail_differs:
    'One receipt matches the reference, but its account settles a different payment gateway. Accept it or match by hand.',
  manual: 'A person vouched for this pair; the matcher had no code for it.',
}
