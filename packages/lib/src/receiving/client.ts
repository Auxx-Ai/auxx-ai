// packages/lib/src/receiving/client.ts

/**
 * Client-safe surface of the receiving module: the landed-cost view the Receive
 * form shows while somebody is keying a receipt, and the GL-account map the
 * write path stamps onto the movement.
 *
 * **No `'use client'` directive here on purpose.** `receive-stock.ts` imports
 * this file on the server, and the directive would turn every export into a
 * client-reference proxy on that side — the same warning `bom/client.ts` and
 * `sequences/client.ts` carry, and the reason `docs/lib-module-guide.md`
 * section 7 states it as a rule rather than a preference.
 *
 * Nothing here touches `db`, the org cache, the logger, or drizzle. UI code must
 * import `@auxx/lib/receiving/client`, never the barrel.
 *
 * plans/purchasing/01-build-plan.md sections 3.2 and 3.5.
 */

import {
  computeLandedBreakdown,
  computeLandedCost,
  type LandedCostBreakdown,
} from '../bom/vendor-cost'

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
  /** A PERCENTAGE, not minor units: `4.3` means 4.3%. */
  tariffRate?: number | null
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
    terms.push(`${format(parts.tariff)} tariff (${formatTariffRate(parts.tariffRate)})`)
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
 * How a part's classification decides which inventory account a receipt lands in
 * (plans/products/01-product-family.md section 4).
 *
 * `subassembly` maps to `1310`, not to `1320`. The build plan's field table names
 * the code space as "`1310` / `1320` / `1330`" but the per-value table in the
 * product-family plan is the one that assigns them, and it puts subassemblies in
 * Raw Materials: `1320` is Work In Process, which is where a part sits *during* a
 * build, not where a purchased subassembly sits on the shelf. Receiving never
 * produces WIP.
 *
 * One map, exported, so the day a chart-of-accounts row moves there is a single
 * place to move it — and so a test can assert the mapping rather than a comment
 * claiming it.
 */
export const GL_ACCOUNT_BY_PART_KIND: Readonly<Record<string, string>> = Object.freeze({
  component: '1310',
  subassembly: '1310',
  finished_good: '1330',
})

/** Where an unclassified part's stock is assumed to sit. See {@link resolveGlAccountForPartKind}. */
export const DEFAULT_RECEIPT_GL_ACCOUNT = '1310'

/**
 * The inventory account code a receipt of this part should be stamped with.
 *
 * NULL reads as `component`, which is `1310` — and that is the conservative
 * choice on purpose. `partKind` is human-set and unbackfilled, so most parts in
 * an existing org read NULL; defaulting an unclassified part into Raw Materials
 * understates Finished Goods rather than overstating it, and it matches what
 * `readPartKind` already does everywhere else NULL is interpreted.
 *
 * An unrecognised value falls to the same default rather than throwing: a
 * receipt is not the place to discover that somebody added a fourth part kind,
 * and a movement stamped `1310` is correctable while a receipt that failed to
 * write is a pallet nobody counted.
 */
export function resolveGlAccountForPartKind(partKind: string | null | undefined): string {
  if (!partKind) return DEFAULT_RECEIPT_GL_ACCOUNT
  return GL_ACCOUNT_BY_PART_KIND[partKind] ?? DEFAULT_RECEIPT_GL_ACCOUNT
}

/**
 * Round a money value to whole minor units.
 *
 * 🛑 `CURRENCY` is cents in a `doublePrecision` column and the landed formula
 * does not round its tariff term, so a fractional-cent tail reaches the write
 * path intact (build plan section 2.2). Every money value this module stores
 * goes through here first — not as defensive tidying, but because an unrounded
 * cent stored in a float is a number that will not compare equal to itself after
 * a round trip, and the three-way match compares stored costs.
 */
export function roundMinorUnits(value: number): number {
  return Math.round(value)
}

/**
 * The extended cost of a movement: `round(unitCost x quantity)`.
 *
 * Rounded **after** multiplying, never as a sum of rounded units: rounding first
 * and multiplying scales the rounding error by the quantity, so a half-cent tail
 * on a 10,000-unit receipt becomes $50 of drift against the vendor's invoice.
 *
 * Signed like `quantity` by construction — a receipt is positive, a vendor
 * return is negative, and the subledger sums to the inventory balance because of
 * that and not in spite of it (build plan section 2.1).
 */
export function computeExtendedCost(unitCost: number, quantity: number): number {
  return Math.round(unitCost * quantity)
}
