// packages/lib/src/money/payouts/client.ts

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

import type { PayoutHeader, PayoutItem } from './source'

export type { PayoutHeader, PayoutItem, PayoutItemRef } from './source'

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
