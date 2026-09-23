// apps/web/src/components/accounting/ui/banking/matches/provider-match-copy.ts

// Brief 102 M4 as copy: one sentence per reason, and the one click each suggestion allows.

import type {
  MatchState,
  ProviderMatchKind,
  ProviderMatchReason,
} from '@auxx/lib/accounting/provider-matches/client'
import type { Variant } from '@auxx/ui/components/badge'

/** The worklist's four views, in tab order; each is one `matchState`. */
export const MATCH_VIEWS = ['suggested', 'pending', 'unmatchable', 'matched'] as const
export type MatchView = (typeof MATCH_VIEWS)[number]

export const PROVIDER_MATCH_STATE_LABEL: Record<MatchState, string> = {
  suggested: 'Suggested',
  pending: 'Waiting',
  unmatchable: 'Needs a person',
  matched: 'Settled',
}

/** The payout items' tone scale (`match-reason-copy.ts`). */
export const PROVIDER_MATCH_STATE_VARIANT: Record<MatchState, Variant> = {
  suggested: 'amber',
  pending: 'outline',
  unmatchable: 'secondary',
  matched: 'green',
}

const CUSTOMER_TXN_TYPES = new Set(['Payment', 'Deposit'])

interface MatchSideHint {
  providerTxnType: string
  matchedKind: ProviderMatchKind | null
  matched?: { vendorBillInstanceId: string | null } | null
}

/** Money out: their bill payment or expense, or ours on a vendor bill. */
function isVendorSide(row: MatchSideHint): boolean {
  return (
    row.matchedKind === 'vendor_bill' ||
    !!row.matched?.vendorBillInstanceId ||
    !CUSTOMER_TXN_TYPES.has(row.providerTxnType)
  )
}

/** One sentence per reason; `provider` is the connected books' name, never at a sentence start. */
export function providerMatchReasonCopy(
  row: MatchSideHint & { matchReason: ProviderMatchReason },
  provider: string
): string {
  const vendor = isVendorSide(row)
  switch (row.matchReason) {
    case 'adopted':
      return vendor
        ? `A bill payment in ${provider} on a bill of ours that had no payment here was recorded against the bill. Their entry is the posting.`
        : `A payment in ${provider} on an invoice of ours that had no receipt here was recorded against the invoice. Their entry is the posting.`
    case 'ours_unsent':
      // A payout of ours carries the fee split a bank-feed *Add* does not, so theirs always goes.
      if (row.matchedKind === 'payout')
        return `A payout of ours for the same amount has not been sent yet. Ours carries the fee split, so Ask to delete theirs raises a work item to remove theirs from ${provider}.`
      return vendor
        ? 'A payment of ours to the same vendor for the same amount has not been sent yet. Keep theirs reverses our payment so it is booked once.'
        : 'A receipt of ours for the same invoice and amount has not been sent yet. Keep theirs reverses our receipt so the payment is booked once.'
    case 'duplicate_sent':
      return `Ours is already in ${provider}, so it holds this twice. Ask to delete theirs raises a work item for whoever keeps the books there.`
    case 'no_payout':
      return "Coded to a payment gateway's clearing account, but no payout of ours fits it yet. It is checked again on the next sync."
    case 'no_candidate':
      return 'It pays a vendor of ours, but no payment or open bill of ours fits it yet. It is checked again on the next sync.'
    case 'pays_bill':
      return `It looks like payment for an open bill of ours, entered as an expense, so the bill stays open in ${provider}. Ask to pay the bill there raises a work item; once they do, the next sync records the payment here.`
    case 'ambiguous':
      return vendor
        ? 'It pays several bills, or more than one payment or bill of ours fits, so the matcher picked none. A person has to decide.'
        : 'More than one record of ours fits, so the matcher picked none. A person has to decide.'
    case 'cannot_adopt':
      return vendor
        ? 'It names our bill but cannot be recorded against it, usually because it is more than the open balance. Check the bill.'
        : 'It names our invoice but cannot be recorded against it, usually because it is more than the open balance. Check the invoice.'
    case 'order_invoice':
      return "It pays the invoice we sent for an order's shipment, and order payments are not matched yet. Record it on the order by hand."
    case 'not_ours':
      return 'It names nothing of ours, so their entry stands alone.'
    case 'dismissed':
      return 'A person dismissed this, and it is not suggested again.'
  }
}

export interface AcceptAction {
  label: string
  /** Set when Accept reverses a posting of ours; the page confirms first. */
  confirm?: { title: string; description: string; confirmText: string }
}

/** What Accept does for this row, or null where Accept is not offered (`acceptProviderMatch`). */
export function providerMatchAcceptAction(
  row: MatchSideHint & {
    matchState: MatchState | null
    matchReason: ProviderMatchReason
    matchedId: string | null
  },
  provider: string
): AcceptAction | null {
  if (row.matchState !== 'suggested' || !row.matchedId || !row.matchedKind) return null
  if (row.matchReason === 'ours_unsent' && row.matchedKind === 'money_transaction') {
    const ours = isVendorSide(row) ? 'payment' : 'receipt'
    return {
      label: 'Keep theirs',
      confirm: {
        title: `Keep the payment from ${provider}?`,
        description: `Our ${ours} is reversed and its export withdrawn, so the payment is booked once, from ${provider}.`,
        confirmText: 'Keep theirs',
      },
    }
  }
  if (row.matchReason === 'pays_bill') return { label: 'Ask to pay the bill there' }
  return { label: 'Ask to delete theirs' }
}

/** Dismiss clears any open state; a settled match is undone from the record it names. */
export function canDismissProviderMatch(matchState: MatchState | null): boolean {
  return matchState === 'suggested' || matchState === 'pending' || matchState === 'unmatchable'
}
