// packages/lib/src/accounting/money/payouts/client.ts

/**
 * The client-safe half of the payout module: statuses, provenance, and the
 * arithmetic that turns a payout's items into the four numbers
 * `buildPayoutEntry` takes.
 *
 * 🛑 **No database, no Stripe SDK, no `@auxx/lib` server imports.** The web app
 * imports this for the payouts list; anything that reaches a bullmq queue or the
 * org cache belongs in `reads.ts` or `sync.ts`. The item and header shapes are
 * `source.ts`'s (type imports only, erased at build).
 */

import type { MatchState } from './match-reasons'
import type { PayoutHeader, PayoutItem } from './source'

export {
  MATCH_STATE_FOR_REASON,
  type MatchReason,
  type MatchState,
  PROCESSOR_MATCH_REASONS,
  PROCESSOR_MATCH_STATES,
} from './match-reasons'
export type { PayoutHeader, PayoutItem, PayoutItemRef } from './source'

/** The `FinancialSourceCoverage.windowKey` of a `payout_membership` row: one acquisition of one payout. */
export function payoutMembershipWindowKey(externalId: string, acquisitionId: string): string {
  return `payout:${externalId}:acquisition:${acquisitionId}`
}

/** A payout's life. Only `paid` carries a posting. */
export const PAYOUT_STATUSES = ['in_transit', 'paid', 'failed', 'reversed'] as const

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]

/** Coerce a stored option id into a status, defaulting to the one a fresh row gets. */
export function resolvePayoutStatus(value: string | null | undefined): PayoutStatus {
  return PAYOUT_STATUSES.includes(value as PayoutStatus) ? (value as PayoutStatus) : 'in_transit'
}

/**
 * Where a payout record came from (brief 27 §6.1). Mirrors `PayoutSource` in
 * `resources/registry/enum-values.ts`. `synced` rows came from a provider feed
 * with their items; `imported` rows carry totals only (§4 rule 2), so their
 * zero unrecognised remainder means "nothing to split", never "everything
 * recognised" - the screen must say which.
 */
export type PayoutSourceValue = 'synced' | 'imported'

/** What {@link splitPayout} decided, ready for `buildPayoutEntry`. */
export interface PayoutSplit {
  /** Gross of the items auxx has a record for. */
  grossMinor: number
  /** Fees withheld on those same items. */
  feesMinor: number
  /** `grossMinor - feesMinor`. */
  netMinor: number
  /** Net of everything else in the payout. */
  unrecognisedNetMinor: number
  /** How many items fell on the unrecognised side. */
  unrecognisedCount: number
}

/**
 * Split a payout's items into what auxx recognises and what it does not.
 *
 * 🛑 **Recognition is per ITEM and keyed on `ref.id`**, never on the amount. Two
 * charges for the same amount on the same day are ordinary, and matching on the
 * number would pair the wrong one and leave the right one unrecognised - with
 * both sides balancing, so nothing would ever surface it. Which lookup answers
 * a given `ref.kind` is `recognise.ts`'s business (§4 rule 1); this function
 * only asks whether the id it was handed is in the set.
 *
 * ⚠️ **A refund is a NEGATIVE item and belongs on the same side as its charge.**
 * `recognised` therefore has to carry refund ids too, which is why the Stripe
 * recogniser reads `stripeRefundId` alongside `stripeChargeId`. A refund whose
 * charge auxx knows about but whose refund it does not would otherwise credit
 * clearing more than was ever debited.
 *
 * An item whose `ref.kind` is `none` is always unrecognised. A payout that
 * recognises nothing is not an error: an org that connected yesterday has a
 * payout full of charges taken before auxx existed, and the whole deposit lands
 * in `unidentified_receipts` where somebody codes it.
 */
export function splitPayout(items: PayoutItem[], recognised: ReadonlySet<string>): PayoutSplit {
  let grossMinor = 0
  let feesMinor = 0
  let unrecognisedNetMinor = 0
  let unrecognisedCount = 0

  for (const item of items) {
    if (item.ref.kind !== 'none' && recognised.has(item.ref.id)) {
      grossMinor += item.grossMinor
      feesMinor += item.feeMinor
      continue
    }
    unrecognisedNetMinor += item.grossMinor - item.feeMinor
    unrecognisedCount += 1
  }

  return {
    grossMinor,
    feesMinor,
    netMinor: grossMinor - feesMinor,
    unrecognisedNetMinor,
    unrecognisedCount,
  }
}

/**
 * One `ProcessorBalanceEntry` row, reduced to what {@link splitStoredEntries}
 * needs. Amounts are integer minor units; the row stores them as `bigint`.
 */
export interface StoredPayoutEntry {
  type: string
  matchState: MatchState | null
  grossMinor: number
  feeMinor: number
  netMinor: number
  /** A matched chargeback whose refund entry already booked the dispute fee (91 D8). */
  feeOnRefund?: boolean
}

/**
 * The split of a payout whose feed has evidence rows: recognition IS the stored
 * match (`plans/accounting/payout-links.md` §11.3).
 *
 * `matched` is recognised. `pending`, `suggested` and `unmatchable` are not, and
 * their net lands in `unidentified_receipts` the same way an unrecognised item
 * always has - a later match is what reverses and re-posts the entry (§13 Q6).
 * A fee, an adjustment or anything else that is never matched carries no state
 * and is unrecognised by construction, exactly as its `ref.kind: 'none'` item
 * was in the lane this replaces.
 *
 * 🛑 The caller excludes `isOutgoingTransfer` rows: that item IS the payout, not
 * something the entry summed (§13 Q2).
 */
export function splitStoredEntries(entries: readonly StoredPayoutEntry[]): PayoutSplit {
  let grossMinor = 0
  let feesMinor = 0
  let unrecognisedNetMinor = 0
  let unrecognisedCount = 0

  for (const entry of entries) {
    // The refund entry booked this chargeback's fee (91 D8) and credited clearing for it,
    // so clearing is relieved of the net and the payout books no second fee.
    if (entry.matchState === 'matched' && entry.feeOnRefund) {
      grossMinor += entry.netMinor
      continue
    }
    if (entry.matchState === 'matched') {
      grossMinor += entry.grossMinor
      feesMinor += entry.feeMinor
      continue
    }
    unrecognisedNetMinor += entry.netMinor
    unrecognisedCount += 1
  }

  return {
    grossMinor,
    feesMinor,
    netMinor: grossMinor - feesMinor,
    unrecognisedNetMinor,
    unrecognisedCount,
  }
}

/** Add two feeds' splits of one payout. One feed is the ordinary case; the sum is the general one. */
export function sumSplits(splits: readonly PayoutSplit[]): PayoutSplit {
  const total: PayoutSplit = {
    grossMinor: 0,
    feesMinor: 0,
    netMinor: 0,
    unrecognisedNetMinor: 0,
    unrecognisedCount: 0,
  }
  for (const split of splits) {
    total.grossMinor += split.grossMinor
    total.feesMinor += split.feesMinor
    total.netMinor += split.netMinor
    total.unrecognisedNetMinor += split.unrecognisedNetMinor
    total.unrecognisedCount += split.unrecognisedCount
  }
  return total
}

/**
 * The split for a source that has totals and no items (§4 rule 2).
 *
 * Recognition equals gross BY CONSTRUCTION: there is no itemisation to leave
 * anything on the unrecognised side, so the remainder and its count are zero.
 * The record this feeds says `source: imported`, which is how the screen tells
 * "nothing to split" from "everything recognised".
 */
export function totalsOnlySplit(totals: NonNullable<PayoutHeader['totals']>): PayoutSplit {
  return {
    grossMinor: totals.grossMinor,
    feesMinor: totals.feesMinor,
    netMinor: totals.grossMinor - totals.feesMinor,
    unrecognisedNetMinor: 0,
    unrecognisedCount: 0,
  }
}
