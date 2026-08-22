// packages/lib/src/bom/vendor-cost.ts

/**
 * The landed-cost formula and the winning-supplier rule — the single definition
 * of both, shared by the server-side cost calculator and the drawer UI.
 *
 * This file is pure: no `db`, no cache, no logger, nothing server-only. That is
 * deliberate and load-bearing. Before it existed the landed formula lived twice
 * — in `cost-calculator.ts` and hand-copied into the Suppliers tab's row
 * component — and the winner rule lived only server-side, so the tab could not
 * say which supplier a part's cost actually came from. It marked *preferred*
 * instead, which is a different thing (see {@link selectWinningVendor}).
 *
 * Re-exported to the client through `bom/client.ts`; never import this module's
 * neighbours from here.
 */

/**
 * One supplier's priced offer for a part.
 *
 * Structural, not a database row: the calculator builds these from `FieldValue`
 * rows and the UI builds them from its field-value store, and neither should
 * have to know the other's shape.
 */
export interface VendorCostRow {
  /**
   * The `vendor_part` instance id. Carried solely so ordering is total — see
   * the tiebreak note on {@link selectWinningVendor}.
   */
  id: string
  /** Minor units (cents for USD). `null` means this offer is not priced. */
  unitPrice: number | null
  /** Minor units. */
  shippingCost: number | null
  /** A PERCENTAGE, not minor units — `10` means 10%. */
  tariffRate: number | null
  /** Minor units. */
  otherCost: number | null
  isPreferred: boolean
}

/**
 * A landed cost split into the four things that produced it, every field in
 * whole minor units.
 *
 * `tariff` is the CURRENCY the rate produced, not the rate — a breakdown that
 * shows "10%" without "$4.00" does not answer *where did the tariff go*.
 * `tariffRate` is carried alongside so a UI can show both without recomputing.
 *
 * **The components sum to `landed` exactly.** See {@link computeLandedBreakdown}.
 */
export interface LandedCostBreakdown {
  unitPrice: number
  shipping: number
  /** The tariff in minor units, rounded to a whole unit. */
  tariff: number
  /** The percentage that produced {@link tariff}, for display. */
  tariffRate: number
  other: number
  /** `unitPrice + shipping + tariff + other`, exact by construction. */
  landed: number
}

/**
 * The exact landed cost: `unit + shipping + (unit x rate/100) + other`.
 *
 * **Unrounded on purpose.** This is what the calculator persists as
 * `part_purchase_cost` / `part_cost`, and it is what {@link selectWinningVendor}
 * orders on. A sub-minor-unit fraction is real here — `4133` at `7.5%` yields
 * `4442.975` — and rounding it at this level would silently change every stored
 * cost. {@link computeLandedBreakdown} is the rounded, display-facing view.
 *
 * Returns `null` for an unpriced offer: an unpriced supplier row is not a
 * zero-cost supplier, it is a row that cannot compete at all.
 */
export function computeLandedCost(row: VendorCostRow): number | null {
  if (row.unitPrice == null) return null
  const shipping = row.shippingCost ?? 0
  const tariff = row.unitPrice * ((row.tariffRate ?? 0) / 100)
  const other = row.otherCost ?? 0
  return row.unitPrice + shipping + tariff + other
}

/**
 * The landed cost split into displayable, whole-minor-unit components.
 *
 * **Why the components are guaranteed to add up.** `unitPrice`, `shippingCost`
 * and `otherCost` are stored as integer minor units; only the tariff term can
 * carry a fraction, because it is the one value computed rather than stored. So
 * for integers a, b, c and a single fractional term f:
 *
 *     round(a + b + f + c) === a + b + c + round(f)
 *
 * Rounding the tariff alone and summing therefore lands on exactly the same
 * whole minor unit as rounding {@link computeLandedCost}'s exact total. A
 * breakdown whose lines do not visibly sum to its own total is worse than no
 * breakdown, and this is why this one always does.
 *
 * Returns `null` when the offer has no unit price, matching
 * {@link computeLandedCost}.
 */
export function computeLandedBreakdown(row: VendorCostRow): LandedCostBreakdown | null {
  if (row.unitPrice == null) return null

  const unitPrice = row.unitPrice
  const shipping = row.shippingCost ?? 0
  const tariffRate = row.tariffRate ?? 0
  const other = row.otherCost ?? 0
  const tariff = Math.round(unitPrice * (tariffRate / 100))

  return {
    unitPrice,
    shipping,
    tariff,
    tariffRate,
    other,
    landed: unitPrice + shipping + tariff + other,
  }
}

/**
 * The supplier offer that a part's cost actually comes from, or `null` when no
 * offer is priced.
 *
 * The rule, in order:
 *
 * 1. **Only priced offers compete.** A supplier row with a lead time and a
 *    shipping cost but no unit price is skipped entirely — it still renders in
 *    the Suppliers tab and can never win.
 * 2. **Any preferred offer beats any non-preferred offer.** This is not a
 *    tiebreak, it short-circuits the comparison: a preferred supplier wins even
 *    when a cheaper one exists, and nothing today enforces that only one row is
 *    preferred, so the preferred *group* wins and rule 3 settles it within that
 *    group.
 * 3. **Cheapest landed wins** — landed, not the sticker unit price. The two
 *    orderings routinely disagree: a $38 offer with $15 shipping loses to a $42
 *    offer with $1 of other costs.
 * 4. **Ties break on `id`**, ascending.
 *
 * Rule 4 is the only behaviour this function adds over the original inline sort.
 * Without it a tie was resolved by whatever order Postgres happened to return,
 * because the underlying query has no `ORDER BY`. That was harmless while the
 * winner was only ever reduced to a number — both rows produce the same landed
 * cost — but the moment a UI marks *which row* won, a non-deterministic winner
 * makes the marker hop between two identical rows for no reason the user can see.
 *
 * Does not mutate `rows`.
 */
export function selectWinningVendor<T extends VendorCostRow>(rows: readonly T[]): T | null {
  let best: T | null = null
  let bestLanded = 0

  for (const row of rows) {
    const landed = computeLandedCost(row)
    if (landed == null) continue

    if (best === null) {
      best = row
      bestLanded = landed
      continue
    }

    if (isBetterOffer(row, landed, best, bestLanded)) {
      best = row
      bestLanded = landed
    }
  }

  return best
}

/**
 * Whether `row` outranks `best` under the rule documented on
 * {@link selectWinningVendor}. Split out so the ordering is stated once and the
 * selection loop stays a loop.
 */
function isBetterOffer(
  row: VendorCostRow,
  rowLanded: number,
  best: VendorCostRow,
  bestLanded: number
): boolean {
  if (row.isPreferred !== best.isPreferred) return row.isPreferred
  if (rowLanded !== bestLanded) return rowLanded < bestLanded
  return row.id < best.id
}
