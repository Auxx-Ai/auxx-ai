// packages/lib/src/builds/client.ts

/**
 * Client-safe half of the builds module: the part-kind vocabulary the standard
 * cost roll is gated on, and the pure arithmetic both the browser preview and
 * the server roll run.
 *
 * No `'use client'` directive — server code imports this file too, and the
 * directive would turn every export into a client-reference proxy there
 * (`docs/lib-module-guide.md` section 7).
 */

/** The three values `part_kind` can hold. Mirrors `PartKind` in the registry. */
export type PartKindValue = 'component' | 'subassembly' | 'finished_good'

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
 * as `resolveGlAccountForPartKind` does: a roll is not the place to discover
 * that somebody added a fourth part kind.
 */
export function resolvePartKind(raw: string | null | undefined): PartKindValue {
  if (raw === 'subassembly' || raw === 'finished_good') return raw
  return 'component'
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

/**
 * Round a money value to whole minor units.
 *
 * 🛑 Not optional. `CURRENCY` is cents in a `doublePrecision` column and
 * `computeLandedCost` can emit a fractional-cent tariff term (Gap C section 1.7,
 * R11). Round before freezing, or every downstream balance check holds by luck
 * instead of by construction — and `setValueWithType` rejects a fractional
 * CURRENCY write outright (`assertCurrencyIntegerMinorUnits`).
 */
export function roundMinorUnits(value: number): number {
  return Math.round(value)
}

/**
 * The absorbed amount for one rate, in whole minor units, or `null`.
 *
 * 🛑 **A NULL rate means "no absorption declared" and must never read as zero.**
 * The two are numerically indistinguishable once summed, so the distinction is
 * kept in the TYPE and carried all the way into storage: a built part rolled
 * while `manufacturing.assemblyLaborCostPerUnit` is unset stores
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

/**
 * The drift between a part's live cost and its frozen standard, in minor units.
 *
 * *How far the standard has moved away from reality since it was last rolled* —
 * which is the number that tells you a roll is due (section 2.4). `null` when
 * either half is missing, because a drift against nothing is not zero drift.
 */
export function standardCostDrift(
  liveCost: number | null | undefined,
  standardCost: number | null | undefined
): number | null {
  if (liveCost == null || standardCost == null) return null
  return liveCost - standardCost
}
