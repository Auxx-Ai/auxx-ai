// packages/lib/src/money/payouts/client.ts

/**
 * The client-safe half of the payout module: statuses, the recognition split,
 * and the arithmetic that turns a gateway's balance transactions into the four
 * numbers `buildPayoutEntry` takes.
 *
 * 🛑 **No database, no Stripe SDK, no `@auxx/lib` server imports.** The web app
 * imports this for the payouts list; anything that reaches a bullmq queue or the
 * org cache belongs in `reads.ts` or `sync.ts`.
 */

/** A payout's life. Only `paid` carries a posting. */
export const PAYOUT_STATUSES = ['in_transit', 'paid', 'failed', 'reversed'] as const

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]

/** Coerce a stored option id into a status, defaulting to the one a fresh row gets. */
export function resolvePayoutStatus(value: string | null | undefined): PayoutStatus {
  return PAYOUT_STATUSES.includes(value as PayoutStatus) ? (value as PayoutStatus) : 'in_transit'
}

/**
 * One settled item inside a payout, reduced to what the split needs.
 *
 * `chargeId` is what a `PaymentTransaction` is matched on; `null` for a balance
 * transaction that is not a charge at all (a Stripe fee, an adjustment, a
 * transfer), which is therefore always unrecognised.
 */
export interface PayoutItem {
  /** The gateway's balance-transaction id. Only used in messages and logs. */
  id: string
  /** The charge this settled, when it settled one. */
  chargeId: string | null
  /** Gross, integer minor units. NEGATIVE for a refund or a dispute. */
  grossMinor: number
  /** What the processor withheld on it, integer minor units. */
  feeMinor: number
}

/** What {@link splitPayout} decided, ready for `buildPayoutEntry`. */
export interface PayoutSplit {
  /** Gross of the items auxx has a payment for. */
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
 * 🛑 **Recognition is per ITEM and keyed on the charge id**, never on the
 * amount. Two charges for the same amount on the same day are ordinary, and
 * matching on the number would pair the wrong one and leave the right one
 * unrecognised - with both sides balancing, so nothing would ever surface it.
 *
 * ⚠️ **A refund is a NEGATIVE item and belongs on the same side as its charge.**
 * `recognisedChargeIds` therefore has to carry refund rows too, which is why
 * {@link gatherPayout}'s caller passes every `PaymentTransaction` charge id it
 * holds rather than only the succeeded charges. A refund whose charge auxx knows
 * about but whose refund it does not would otherwise credit clearing more than
 * was ever debited.
 *
 * A payout that recognises nothing is not an error: an org that connected Stripe
 * yesterday has a payout full of charges taken before auxx existed, and the
 * whole deposit lands in `unidentified_receipts` where somebody codes it.
 */
export function splitPayout(
  items: PayoutItem[],
  recognisedChargeIds: ReadonlySet<string>
): PayoutSplit {
  let grossMinor = 0
  let feesMinor = 0
  let unrecognisedNetMinor = 0
  let unrecognisedCount = 0

  for (const item of items) {
    if (item.chargeId && recognisedChargeIds.has(item.chargeId)) {
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
