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
 *
 * The one import is `../errors`, which is a dependency-free leaf of plain
 * classes — it is not a neighbour of this module and pulls nothing into a
 * browser bundle.
 */

import { BadRequestError } from '../errors'

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

// ─────────────────────────────────────────────────────────────────────
// The tariff schedule (plans/money/tasks/29-tariff-schedule.md §3)
// ─────────────────────────────────────────────────────────────────────

/**
 * One dated row of a `tariff_code`'s schedule.
 *
 * Structural, like {@link VendorCostRow}: the server builds these from
 * `FieldValue` rows and the settings screen builds them from its field-value
 * store, and neither should have to know the other's shape.
 */
export interface TariffRateRow {
  /** The `tariff_rate` instance id. Carried so ordering is total. */
  id: string
  /**
   * What imposes the rate - `MFN`, `Section 301 List 3`, `IEEPA fentanyl`.
   *
   * **A blank or null authority is its own authority**, not a missing value.
   * Left blank on every row the rule degrades to "the latest row wins", which
   * is the simple blended schedule people enter first.
   */
  authority: string | null
  /** A PERCENTAGE, not minor units - `25` means 25%. */
  rate: number | null
  /**
   * The day this rate took effect.
   *
   * A calendar day, not an instant. A `Date` is read in **UTC** because that is
   * how a `FieldType.DATE` value is stored - reinterpreting midnight UTC in a
   * western timezone would move every row back a day. A string is taken as
   * already being a `YYYY-MM-DD` day and only its first ten characters are read.
   */
  effectiveFrom: Date | string | null
  /** `9903.88.03`. Display only - see {@link TariffResolution}. */
  chapter99Code: string | null
}

/** One authority's winning row, as resolved at a lookup date. */
export interface TariffRateComponent {
  id: string
  /** `null` for the unnamed authority. */
  authority: string | null
  /** The percentage this authority contributes. */
  rate: number
  /** The resolved `YYYY-MM-DD` day the row took effect. */
  effectiveFrom: string
  /**
   * 🛑 Carried for DISPLAY and reconciliation only. It lets someone check an
   * estimate against the broker's entry summary line by line and know which
   * rows a Federal Register notice touches. The arithmetic never reads it.
   */
  chapter99Code: string | null
}

/** Why {@link TariffResolution.rate} is what it is. */
export type TariffResolutionStatus =
  /** No rate rows at all. The code is unclassified and the rate is not "0%". */
  | 'unclassified'
  /** Rows exist, but every one of them starts AFTER the lookup date. */
  | 'pending'
  /** At least one authority is in force; `components` says which. */
  | 'resolved'

/**
 * A resolved duty rate, with the components that produced it.
 *
 * 🛑 **`rate` alone is not a sufficient answer and callers must not treat it as
 * one.** Under a summing rule a code with a Section 301 row and no base row
 * resolves to 25% rather than 27%, and nothing about the number looks wrong.
 * The only way anyone catches that is by seeing the components, which is the
 * same argument {@link LandedCostBreakdown} already makes: a breakdown that
 * shows "10%" without "$4.00" does not answer *where did the tariff go*.
 *
 * `status` exists so `unclassified` is never mistaken for "0%". They produce
 * the same arithmetic and mean opposite things - one is a domestic part with no
 * duty, the other is an unfinished row.
 */
export interface TariffResolution {
  status: TariffResolutionStatus
  /**
   * The summed percentage in force at the lookup date. `0` for both
   * `unclassified` and `pending`.
   */
  rate: number
  /**
   * One entry per authority in force, oldest `effectiveFrom` first - the order
   * an entry summary reads in (MFN, then the 301 layer, then IEEPA). Empty
   * unless `status` is `resolved`.
   */
  components: TariffRateComponent[]
}

/**
 * The resolution rule: **sum the latest row per `authority`, as of `atDate`.**
 *
 * ```
 * rate(code, date) = SUM over distinct authority of (
 *   the row with the greatest effectiveFrom <= date, for that authority
 * ).rate
 * ```
 *
 * One rule covers both shapes people actually enter. With every `authority`
 * blank it degrades exactly to "the latest row wins" - the simple blended
 * schedule. The day someone wants MFN and 301 apart they start filling
 * `authority` in and nothing else changes.
 *
 * **Pure**, and deliberately so: it is called server-side by the cost
 * calculator and in the browser by the tariffs settings screen and the supplier
 * drawer, through `bom/client.ts`. Resolving server-side only and shipping the
 * client a number is how the landed formula came to live in two places once
 * already.
 *
 * ### Why the timezone is a parameter
 *
 * `effectiveFrom` is a calendar day and `atDate` is an instant, so turning the
 * instant into a day is a timezone decision - and it is the org's
 * `bookTimeZone`, the same rule `gather-month-end-inventory.ts` applies to
 * period membership. Compared in UTC, a rate that starts on March 2 values a
 * March 1 evening lookup on the wrong side of the change, silently and by
 * exactly one day. The default is `'UTC'`, which is correct only when the
 * caller has already normalized; pass the org's book timezone otherwise.
 *
 * ### What it does not do
 *
 * It has no opinion on the supplier offer's override. Precedence (§3.1) is the
 * caller's: a set `vendor_part.tariffRate` wins and this function is not called
 * at all.
 *
 * @param rows Every rate row for ONE `tariff_code`. Rows for other codes must
 *   not be mixed in - nothing here can tell them apart.
 * @param atDate The instant to resolve as of.
 * @param timeZone IANA zone the instant is turned into a day in.
 * @throws {BadRequestError} when `atDate` is an invalid `Date`.
 */
export function resolveTariffRate(
  rows: readonly TariffRateRow[],
  atDate: Date,
  timeZone = 'UTC'
): TariffResolution {
  if (Number.isNaN(atDate.getTime())) {
    throw new BadRequestError('Cannot resolve a tariff rate at an invalid date')
  }
  if (rows.length === 0) return { status: 'unclassified', rate: 0, components: [] }

  const asOf = dayKeyInZone(atDate, timeZone)

  // Latest row per authority, blank grouped as its own. A row with no usable
  // day is skipped rather than treated as "always in force": `effectiveFrom` is
  // required on every row, so an absent one is a broken row, and letting it win
  // would silently shadow the real schedule.
  const winners = new Map<string, { row: TariffRateRow; day: string }>()
  for (const row of rows) {
    const day = effectiveDay(row.effectiveFrom)
    if (day === null || day > asOf) continue

    const key = authorityKey(row.authority)
    const held = winners.get(key)
    if (!held || day > held.day || (day === held.day && row.id > held.row.id)) {
      winners.set(key, { row, day })
    }
  }

  if (winners.size === 0) return { status: 'pending', rate: 0, components: [] }

  const components: TariffRateComponent[] = [...winners.values()].map(({ row, day }) => ({
    id: row.id,
    authority: normalizeAuthority(row.authority),
    rate: row.rate ?? 0,
    effectiveFrom: day,
    chapter99Code: row.chapter99Code,
  }))

  components.sort(compareComponents)

  return {
    status: 'resolved',
    rate: components.reduce((total, component) => total + component.rate, 0),
    components,
  }
}

/**
 * Display order: oldest first, so a code reads the way an entry summary does -
 * the base duty, then the layers stacked on top of it. Ties fall through to the
 * authority and then the id so the order is TOTAL: two rows sharing a day would
 * otherwise swap places between renders for no reason a user can see, exactly
 * as {@link selectWinningVendor}'s tiebreak prevents.
 */
function compareComponents(a: TariffRateComponent, b: TariffRateComponent): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1
  const aa = a.authority ?? ''
  const ba = b.authority ?? ''
  if (aa !== ba) return aa < ba ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * The grouping key for an authority. Trimmed and case-folded so `MFN`, `mfn`
 * and ` MFN ` are one authority rather than three that all get summed - which
 * would triple a base duty with nothing on screen to show it.
 */
function authorityKey(authority: string | null): string {
  return (authority ?? '').trim().toLowerCase()
}

/** The authority as displayed: trimmed, and empty folded back to `null`. */
function normalizeAuthority(authority: string | null): string | null {
  const trimmed = (authority ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A row's effective day as `YYYY-MM-DD`, or `null` when it has none.
 *
 * A `Date` is read in UTC on purpose - see {@link TariffRateRow.effectiveFrom}.
 */
function effectiveDay(effectiveFrom: Date | string | null): string | null {
  if (effectiveFrom == null) return null
  if (typeof effectiveFrom === 'string') {
    const day = effectiveFrom.slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
  }
  if (Number.isNaN(effectiveFrom.getTime())) return null
  return effectiveFrom.toISOString().slice(0, 10)
}

/**
 * An instant as a `YYYY-MM-DD` day in `timeZone`.
 *
 * `Intl.DateTimeFormat` with the `en-CA` locale because that locale's short
 * date format IS `YYYY-MM-DD`; hand-rolled offset arithmetic gets DST wrong
 * roughly twice a year. The same technique `postings/periods.ts` uses, copied
 * rather than imported because this file stays free of lib neighbours.
 */
function dayKeyInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
