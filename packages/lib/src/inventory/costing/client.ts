// packages/lib/src/inventory/costing/client.ts

/**
 * Client-safe surface of the costing module: the landed-cost formula, the
 * winning-supplier rule, the tariff-rate resolution, and the part-kind
 * vocabulary the standard-cost roll is gated on.
 *
 * No `'use client'` directive here on purpose — server code imports these
 * functions too (the cost calculator itself does), and the directive would turn
 * every export into a client-reference proxy on that side
 * (`docs/lib-module-guide.md` section 7).
 */

import { roundMinorUnits } from '@auxx/utils/currency'

/** The values `part_kind` can hold. Mirrors `PartKind` in the registry. */
export type PartKindValue = 'component' | 'subassembly' | 'finished_good' | 'service'

/** The two kinds a build can produce, and the only two that absorb conversion cost. */
const BUILT_PART_KINDS: ReadonlySet<PartKindValue> = new Set<PartKindValue>([
  'subassembly',
  'finished_good',
])

/**
 * Read a stored `part_kind` option value as a {@link PartKindValue}.
 *
 * 🛑 **NULL reads as `component`** (Gap C section 3.3), which is the conservative
 * direction: an unclassified part gets no labour and no overhead, so nothing is
 * capitalised that was never spent. It is also the *wrong* default for a part
 * that is genuinely built — `part_kind` is set on 5 of 218 parts in the dev org
 * — so classifying the built parts is a prerequisite of the first roll, not an
 * afterthought.
 *
 * An unrecognised string falls to the same default rather than throwing, exactly
 * as `resolveInventoryRoleForPartKind` does: a roll is not the place to discover
 * that somebody added a fourth part kind.
 */
export function resolvePartKind(raw: string | null | undefined): PartKindValue {
  if (raw === 'subassembly' || raw === 'finished_good' || raw === 'service') return raw
  return 'component'
}

/** A service is sold but never stocked: no movement, standard, BOM or stock status (107-D10). */
export function isServicePartKind(raw: string | null | undefined): boolean {
  return raw === 'service'
}

/** Whether a build can produce this kind: `subassembly` or `finished_good`. */
export function isBuildablePartKind(partKind: PartKindValue): boolean {
  return BUILT_PART_KINDS.has(partKind)
}

/**
 * Does this part kind absorb direct labour and overhead?
 *
 * 🛑 Gate on `partKind`, **never** on `part_cost_source`. `source` is itself
 * computed and flips the moment somebody adds a vendor price to a part that
 * also has a bill of materials, so a part gated on it would silently change its
 * costing basis. `partKind` is the stored, auditable classification (README
 * B11, Gap C section 3.2).
 */
export function absorbsConversionCost(partKind: PartKindValue): boolean {
  return BUILT_PART_KINDS.has(partKind)
}

/** The values `part_standard_cost_origin` can hold (106 D9). Mirrors `PartStandardCostOrigin`. */
export type StandardCostOriginValue =
  | 'supplier_price'
  | 'opening_stock'
  | 'receipt'
  | 'manual'
  | 'channel'
  | 'roll'

/** The two values `part_standard_cost_source` can hold (73 §6.4). */
export type StandardCostSourceValue = 'provisional' | 'confirmed'

/**
 * Read a stored `part_standard_cost_source` option value, or `null`.
 *
 * 🛑 **`null` is not `provisional`.** An absent source is a part rolled before
 * the field existed; calling it provisional would hand the next receipt licence
 * to overwrite a standard somebody agreed to. The replace-on-first-receipt
 * branch fires only on a stored `provisional`.
 */
export function resolveStandardCostSource(
  raw: string | null | undefined
): StandardCostSourceValue | null {
  return raw === 'provisional' || raw === 'confirmed' ? raw : null
}

/**
 * A rolled standard's source: `confirmed` only when every input a person could
 * have guessed is itself confirmed (73 §6.4 — "a buildable's roll is
 * provisional while any child is provisional").
 *
 * A part with no children keeps whatever it already carries: a roll re-derives
 * a purchased component's standard from a vendor price, which is the same guess
 * it started from, so it cannot confirm anything a receipt has not.
 */
export function rolledStandardCostSource(
  own: StandardCostSourceValue | null,
  childSources: readonly (StandardCostSourceValue | null)[]
): StandardCostSourceValue | null {
  if (childSources.length === 0) return own
  return childSources.some((source) => source !== 'confirmed') ? 'provisional' : 'confirmed'
}

/**
 * `part_labor_cost_per_unit` / `part_overhead_cost_per_unit`, rounded to a
 * RATE's precision, or `null`.
 *
 * 🛑 **A NULL rate means "no absorption declared" and must never read as zero.**
 * The two are numerically indistinguishable once summed, so the distinction is
 * kept in the TYPE and carried all the way into storage: a built part rolled
 * with an empty `part_labor_cost_per_unit` stores
 * `part_standard_labor_cost = NULL`, not `0`. A stored `0` then means somebody
 * deliberately declared a zero rate, which is a different (and checkable) claim.
 *
 * A `component` is the one case that legitimately stores `0`: we did not
 * assemble it, so its labour is zero as a fact rather than as an absence.
 */
export function absorbedRate(rate: number | null | undefined): number | null {
  if (rate == null) return null
  if (!Number.isFinite(rate)) return null
  return roundMinorUnits(rate)
}

export type {
  LandedCostBreakdown,
  OfferTariff,
  OfferTariffInputs,
  TariffRateComponent,
  TariffRateRow,
  TariffResolution,
  TariffResolutionStatus,
  VendorCostRow,
} from './vendor-cost'
export {
  composeTariffCodeLabel,
  computeLandedBreakdown,
  computeLandedCost,
  // The supplier form, the Suppliers tab, the Receive form and the Classification
  // tab all decide an offer's rate through this one function (30 §1).
  resolveOfferTariff,
  // The tariffs settings screen and the supplier drawer resolve the schedule in
  // the browser through this export. Resolving server-side only and shipping
  // the client a number is how the landed formula came to live in two places.
  resolveTariffRate,
  selectWinningVendor,
} from './vendor-cost'
