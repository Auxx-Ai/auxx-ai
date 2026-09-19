// packages/lib/src/inventory/receiving/accruals.ts

/**
 * What a receipt owes, split by who will bill for it (73 §7.2).
 *
 * The standard is LANDED — `computeLandedCost` puts freight, duty and other
 * adders into `part_cost` and the roll carries that into the standard — so a
 * receipt valued at the standard has capitalised money three different parties
 * will invoice. Each gets its own credit: the goods vendor's `grni`, the
 * carrier's `freight_accrual`, the broker's `duties_accrual`. `ppv` takes
 * whatever the frozen standard differs from today's estimate of the three.
 *
 * PURE. No `db`, no clock. The components are read at receipt time by the two
 * receiving doors and handed here.
 */

import type { ReceiveAccrualInput } from '../../accounting/ledger/builders/inventory-movement'
import { computeExtendedCost } from '../movements/client'

/**
 * The four per-unit numbers a receipt accrues on, all minor units except the
 * rate.
 *
 * 🛑 `agreedUnitPrice` is the ORDER's frozen price, not the supplier row's
 * standing one: D2's bill debits `grni` at the agreed price, so the receipt has
 * to credit it at the same figure or the accrual never closes. Only the three
 * adders come off the `vendor_part` row.
 */
export interface ReceiptAccrualTerms {
  agreedUnitPrice: number
  /** `vendor_part_shipping_cost`, per unit. */
  shippingCost?: number | null
  /** `vendor_part_other_cost`, per unit. */
  otherCost?: number | null
  /** A PERCENTAGE, already resolved (override or schedule): `25` means 25%. */
  tariffRate?: number | null
}

/**
 * The landed unit cost a receipt would freeze if it set the standard itself.
 *
 * This is what §6.4's provisional first receipt replaces the guess with — the
 * agreed price plus everything the receipt is about to accrue, not the agreed
 * price alone. Replacing with the price alone would credit the accruals against
 * a standard that never held them and post the whole freight-and-duty estimate
 * to `ppv` as a favourable variance.
 */
export function landedUnitEstimate(terms: ReceiptAccrualTerms): number {
  const { agreedUnitPrice } = terms
  const shipping = terms.shippingCost ?? 0
  const other = terms.otherCost ?? 0
  const tariff = Math.round(agreedUnitPrice * ((terms.tariffRate ?? 0) / 100))
  return agreedUnitPrice + shipping + tariff + other
}

/**
 * One movement's three credit amounts, extended and signed like its quantity.
 *
 * A zero component stays zero and the builder drops the leg, so an org with no
 * tariffs never references `duties_accrual`. Extended through
 * `computeExtendedCost`, so every figure is a whole minor unit on the same
 * rounding rule the movement's own cost took.
 */
export function computeReceiptAccrual(
  terms: ReceiptAccrualTerms,
  quantity: number
): ReceiveAccrualInput {
  const shipping = terms.shippingCost ?? 0
  const other = terms.otherCost ?? 0
  const rate = terms.tariffRate ?? 0
  return {
    grniMinor: computeExtendedCost(terms.agreedUnitPrice, quantity),
    freightMinor: computeExtendedCost(shipping + other, quantity),
    dutiesMinor: computeExtendedCost(terms.agreedUnitPrice * (rate / 100), quantity),
  }
}
