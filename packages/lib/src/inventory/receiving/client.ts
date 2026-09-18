// packages/lib/src/inventory/receiving/client.ts

/**
 * Client-safe surface of the receiving module: the landed-cost view the Receive
 * form shows while somebody is keying a receipt.
 *
 * **No `'use client'` directive here on purpose.** `receive-stock.ts` imports
 * this file on the server, and the directive would turn every export into a
 * client-reference proxy on that side — the same warning `bom/client.ts` and
 * `sequences/client.ts` carry, and the reason `docs/lib-module-guide.md`
 * section 7 states it as a rule rather than a preference.
 *
 * Nothing here touches `db`, the org cache, the logger, or drizzle. UI code must
 * import `@auxx/lib/inventory/receiving/client`, never the barrel.
 *
 * plans/purchasing/01-build-plan.md sections 3.2 and 3.5.
 */

import {
  computeLandedBreakdown,
  computeLandedCost,
  type LandedCostBreakdown,
} from '../costing/vendor-cost'

/**
 * A supplier's priced terms, in the shape a receipt cares about.
 *
 * Deliberately *not* `VendorCostRow`: that type carries `id` and `isPreferred`
 * because it exists to be **ranked** against sibling offers, and a receipt is
 * past the point of ranking — the buyer already chose. Asking the Receive form
 * to invent an `id` and an `isPreferred` it has no use for would be noise.
 */
export interface ReceiptCostInputs {
  /** Minor units. `null` means "this supplier row is not priced" — not "free". */
  unitPrice: number | null
  /** Minor units, per unit. */
  shippingCost?: number | null
  /** A PERCENTAGE, not minor units: `4.3` means 4.3%. Already RESOLVED - override or schedule. */
  tariffRate?: number | null
  /**
   * Where {@link tariffRate} came from, for the summary line. Display only;
   * the arithmetic never reads it. Absent on the server path, which has no
   * summary to print.
   */
  tariffSource?: 'override' | 'schedule' | null
  /** Minor units, per unit. */
  otherCost?: number | null
}

/**
 * The landed unit cost split into the parts that produced it, all whole minor
 * units, plus the rate that produced the tariff so the form can show both.
 *
 * `base` is this module's name for what the supplier row calls `unitPrice`: on a
 * receipt the raw supplier price is the *base* the adders sit on top of, and the
 * word `unitPrice` is already spoken for by the landed figure that gets frozen
 * onto the movement. Keeping the two apart in the type is what stops the form
 * from displaying one and writing the other.
 *
 * **The parts sum to `landed` exactly** — see {@link computeReceiptLandedBreakdown}.
 */
export interface ReceiptCostParts {
  /** The raw supplier price per unit, minor units. */
  base: number
  /** Freight per unit, minor units. */
  freight: number
  /** The tariff in minor units (rounded), NOT the rate. */
  tariff: number
  /** The percentage that produced {@link tariff}, carried for display. */
  tariffRate: number
  /** Where the rate came from, when the caller knows. See {@link ReceiptCostInputs.tariffSource}. */
  tariffSource?: 'override' | 'schedule' | null
  /** Anything else the supplier row capitalises, minor units. */
  other: number
  /** `base + freight + tariff + other`, exact by construction. */
  landed: number
}

/** Adapt a receipt-shaped cost input to the shared `VendorCostRow` shape. */
function toVendorCostRow(inputs: ReceiptCostInputs) {
  return {
    // Neither field participates in the landed formula; ranking is not what a
    // receipt is doing. See the note on `ReceiptCostInputs`.
    id: '',
    isPreferred: false,
    unitPrice: inputs.unitPrice,
    shippingCost: inputs.shippingCost ?? null,
    tariffRate: inputs.tariffRate ?? null,
    otherCost: inputs.otherCost ?? null,
  }
}

/**
 * The exact landed unit cost — `base + freight + (base x rate/100) + other`.
 *
 * **Delegates to `bom/vendor-cost.ts` rather than restating the arithmetic.**
 * The landed formula previously lived twice in this codebase (in the cost
 * calculator and hand-copied into the Suppliers tab) and `vendor-cost.ts` exists
 * precisely to end that. A receipt that valued stock by a *third* copy could
 * disagree with the part cost the same supplier row produces, which is the
 * failure this module is supposed to prevent, not commit.
 *
 * **Unrounded**, matching the function it wraps: `4133` at `7.5%` is `4442.975`
 * and that fractional-cent tail is real. The write path rounds once, at the
 * point of storage (build plan section 3.2 step 3).
 *
 * `null` for an unpriced supplier row: an unpriced row is not a zero-cost row,
 * it is a row that cannot value a receipt at all. That distinction is the whole
 * of the zero-cost guard in `receiveStock`.
 */
export function computeReceiptLandedCost(inputs: ReceiptCostInputs): number | null {
  return computeLandedCost(toVendorCostRow(inputs))
}

/**
 * The landed unit cost split into displayable, whole-minor-unit parts.
 *
 * This is what lets the Receive form show the number it is about to freeze,
 * broken out — `$47.10 = $44.00 + $1.20 freight + $1.90 tariff (4.3%)` — instead
 * of a total the person keying it has to take on faith (build plan section 3.5).
 *
 * The parts are guaranteed to add up. `base`, `freight` and `other` are stored
 * integers and only the tariff term can carry a fraction, so for integers a, b,
 * c and a single fractional term f, `round(a + b + f + c) === a + b + c + round(f)`.
 * A breakdown whose lines do not visibly sum to its own total is worse than no
 * breakdown; that proof is why this one always does.
 *
 * `null` when the row has no price, matching {@link computeReceiptLandedCost}.
 */
export function computeReceiptLandedBreakdown(inputs: ReceiptCostInputs): ReceiptCostParts | null {
  const breakdown: LandedCostBreakdown | null = computeLandedBreakdown(toVendorCostRow(inputs))
  if (!breakdown) return null
  return {
    base: breakdown.unitPrice,
    freight: breakdown.shipping,
    tariff: breakdown.tariff,
    tariffRate: breakdown.tariffRate,
    // Only when the caller said: the server path has no source to report and
    // its consumers compare these parts by exact shape.
    ...(inputs.tariffSource !== undefined ? { tariffSource: inputs.tariffSource } : {}),
    other: breakdown.other,
    landed: breakdown.landed,
  }
}

/**
 * Render a breakdown as the one-line explanation the Receive form shows under
 * the price input: `$47.10 = $44.00 + $1.20 freight + $1.90 tariff (4.3%)`.
 *
 * Zero parts are omitted rather than printed as `+ $0.00`, because a line of
 * zeroes reads as "these were considered and came out empty" when what it
 * actually means is "this supplier row has no freight terms." A single-term
 * landed cost renders as just the total, which is the honest rendering of a
 * receipt with nothing capitalised onto it.
 *
 * Formatting only — the arithmetic is {@link computeReceiptLandedBreakdown}'s,
 * and this function never rounds, so what it prints is what will be stored.
 */
export function formatLandedCostSummary(
  parts: ReceiptCostParts,
  format: (minorUnits: number) => string = formatMinorUnitsUsd
): string {
  const terms: string[] = []
  if (parts.freight !== 0) terms.push(`${format(parts.freight)} freight`)
  if (parts.tariff !== 0) {
    // `(47%, schedule)` / `(12%, override)` - the source rides along so a
    // person can tell a hand-keyed rate from a resolved one (task 30 §5).
    const source = parts.tariffSource ? `, ${parts.tariffSource}` : ''
    terms.push(`${format(parts.tariff)} tariff (${formatTariffRate(parts.tariffRate)}${source})`)
  }
  if (parts.other !== 0) terms.push(`${format(parts.other)} other`)
  if (terms.length === 0) return format(parts.landed)
  return `${format(parts.landed)} = ${format(parts.base)} + ${terms.join(' + ')}`
}

/** `4.3` -> `4.3%`, `10` -> `10%`. Trailing zeros dropped; the rate is a label, not a total. */
function formatTariffRate(rate: number): string {
  const rounded = Math.round(rate * 100) / 100
  return `${rounded}%`
}

/** Default renderer for the summary: minor units to `$1,234.56`. */
function formatMinorUnitsUsd(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : ''
  const abs = Math.abs(minorUnits)
  const whole = Math.floor(abs / 100)
  const cents = abs % 100
  return `${sign}$${whole.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`
}

/**
 * The opening-stock shapes, re-exported for the browser.
 *
 * Type-only, and `types.ts` has no imports at all, so nothing server-side is
 * pulled across by this. The Costing page's pure half (row states, chip counts,
 * the excluded block) is written against these without reaching for the barrel.
 */
export type {
  BulkOpeningStockInput,
  BulkOpeningStockSummary,
  OpenedOpeningStockRow,
  OpeningStockCandidate,
  OpeningStockEntry,
  OpeningStockSkip,
  OpeningStockSkipReason,
} from './types'
