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

// ─── The build event (phase 2) ─────────────────────────────────────────
//
// plans/products/build/01-build-plan.md section 3, README B2/B6/B7/B8.

/** The four values `build_status` can hold. Mirrors `BuildStatus` in the registry. */
export type BuildStatusValue = 'planned' | 'in_progress' | 'completed' | 'canceled'

/** Human labels, so a caller never has to re-derive them from the enum. */
export const BUILD_STATUS_LABELS: Readonly<Record<BuildStatusValue, string>> = Object.freeze({
  planned: 'Planned',
  in_progress: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled',
})

/**
 * Read a stored `build_status` option value, or `null`.
 *
 * 🛑 **Unlike {@link resolvePartKind}, an absent status does NOT fall back.** A
 * part with no `part_kind` is an unclassified part and reading it as a
 * `component` is the conservative direction; a build with no status is a row
 * whose lifecycle nobody can state, and defaulting it to `planned` would let
 * `completeBuild` write an append-only ledger entry against it. `build_status`
 * carries `defaultValue: 'planned'` and `createBuild` sets it explicitly, so
 * `null` here is a data problem, and the write paths refuse it.
 */
export function resolveBuildStatus(raw: string | null | undefined): BuildStatusValue | null {
  if (raw === 'planned' || raw === 'in_progress' || raw === 'completed' || raw === 'canceled') {
    return raw
  }
  return null
}

/** `planned` is the only status a run can be started from. */
export function canStartBuild(status: BuildStatusValue | null): boolean {
  return status === 'planned'
}

/**
 * The two statuses `completeBuild` accepts.
 *
 * 🛑 **B8 — one completion per build.** `completed` is deliberately absent: a
 * run finished in tranches is a second build, not a second completion, because
 * multi-completion needs per-tranche movement batches, a partial-consumption
 * watermark and a variance per tranche. `canceled` is absent for the obvious
 * reason.
 */
export function canCompleteBuild(status: BuildStatusValue | null): boolean {
  return status === 'planned' || status === 'in_progress'
}

/** A run can be abandoned right up until it is completed. */
export function canCancelBuild(status: BuildStatusValue | null): boolean {
  return status === 'planned' || status === 'in_progress'
}

/**
 * `planned` is the only status whose plan may be amended.
 *
 * 🛑 **Deliberately NARROWER than {@link canCancelBuild}, and the difference is
 * the whole point.** An `in_progress` build has written no movements either
 * (B2 — `startBuild` only flips the status), so a ledger argument would let it
 * through. The reason it is refused is **operational**: material may already be
 * cut against the quantity somebody was told to build. So an `in_progress`
 * build is *cancellable but never silently amendable*
 * (plans/products/13-order-build-reconciliation.md §1.0(a) and §1.5).
 *
 * `completed` and `canceled` are terminal for the usual reasons — B6/B8 — and a
 * `null` status is refused like every other write gate here
 * ({@link resolveBuildStatus}).
 */
export function canAmendBuild(status: BuildStatusValue | null): boolean {
  return status === 'planned'
}

/**
 * Only a completed build can be reversed.
 *
 * B6: a completed build is never edited or deleted — it is reversed by a second
 * build carrying the ORIGINAL's frozen costs. A `planned` build has written
 * nothing (B2), so there is nothing to reverse; cancelling it is the whole of
 * the correction.
 */
export function canReverseBuild(status: BuildStatusValue | null): boolean {
  return status === 'completed'
}

/**
 * Units that entered the run: good units plus scrap.
 *
 * 🛑 **B7 — this, and not `quantityProduced`, is what consumes material.** A
 * unit that was started and then lost still ate its components; pretending
 * otherwise would leave the ledger holding material that is physically gone.
 * Its cost falls out in `varianceAmount` (account 5090) rather than being
 * absorbed into the survivors, because absorbing it would give the same variant
 * a different unit cost on every run and destroy the point of a standard.
 */
export function unitsStarted(quantityProduced: number, quantityScrapped: number): number {
  return quantityProduced + quantityScrapped
}

/** `qtyPer x unitsStarted` — the BOM quantity for one component of one run. */
export function componentConsumption(qtyPerUnit: number, started: number): number {
  return qtyPerUnit * started
}

/**
 * `(material + labour + overhead) - producedValue`, in whole minor units.
 *
 * Positive means the run cost MORE than the standard says the output is worth,
 * and the difference is a debit to **5090**. The three inputs are the absorbed
 * amounts for the units STARTED; `producedValue` values only the units that
 * survived. So with no scrap and a standard that agrees with the bill of
 * materials the terms cancel exactly and the variance is zero, and with `s`
 * units scrapped it comes out at `s x standardCost` — the scrapped units' whole
 * standard cost, which is precisely what B7 says should land in 5090.
 */
export function buildVariance(parts: {
  materialCost: number
  laborCost: number
  overheadCost: number
  producedValue: number
}): number {
  return parts.materialCost + parts.laborCost + parts.overheadCost - parts.producedValue
}

/**
 * The account a build's variance belongs to. Never posted here (README B9) —
 * carried so the number and its destination stay in one place.
 */
export const BUILD_VARIANCE_ACCOUNT = '5090'

/**
 * The absorbed amount for one rate over the WHOLE run, in whole minor units.
 *
 * An explicit input from the completion form wins. Otherwise it is the declared
 * rate times the units STARTED — not the units produced.
 *
 * 🛑 The choice of `unitsStarted` is what makes the variance arithmetic close.
 * With `s` units scrapped, material, labour and overhead are all absorbed on
 * `produced + s` while `producedValue` values only `produced`, so the variance
 * comes out at exactly `s x standardCost`: the scrapped units' whole standard
 * cost, to 5090, which is what B7 asks for. Absorbing labour on the survivors
 * instead would net the scrap loss down to material alone and understate it.
 *
 * An UNDECLARED rate absorbs `0` here, and that is not the same decision
 * {@link absorbedRate} makes for the part standard. There, a NULL must survive
 * into storage because it is the difference between "no rate declared" and "a
 * declared rate of zero" on a number that gets rolled up and frozen forever.
 * Here the field records what a specific run actually absorbed, and a run under
 * no declared rate absorbed nothing — which is a fact, not an absence. It also
 * keeps the arithmetic consistent: with no rate the part's standard carries no
 * labour either, so both sides of the variance stay zero.
 */
export function absorbedRunCost(
  explicit: number | null | undefined,
  rate: number | null | undefined,
  started: number
): number {
  if (explicit != null && Number.isFinite(explicit)) return roundMinorUnits(explicit)
  if (rate == null || !Number.isFinite(rate)) return 0
  return roundMinorUnits(rate * started)
}

/** The five numbers a completion freezes onto the build, all in whole minor units. */
export interface BuildCompletionSummary {
  /** Sum of the consumed lines' extended standard cost, POSITIVE. */
  materialCost: number
  laborCost: number
  overheadCost: number
  /** `round(quantityProduced x the produced part's standard cost)`. */
  producedValue: number
  /** `(material + labour + overhead) - producedValue` -> account 5090. */
  varianceAmount: number
}

/** Everything {@link summarizeBuildCompletion} needs, and nothing that touches a database. */
export interface BuildCompletionInputs {
  /** The priced component lines, exactly as `explodeBuildComponents` returns them. */
  components: readonly { extendedCost: number | null }[]
  /** The produced part's frozen standard cost. */
  producedUnitCost: number
  quantityProduced: number
  quantityScrapped: number
  /** An explicit absorbed amount for the whole run, or absent to use the rate. */
  laborCost?: number | null
  overheadCost?: number | null
  /** The two `manufacturing.*` org rates, per assembled unit. `null` absorbs nothing. */
  rates: { laborCostPerUnit: number | null; overheadCostPerUnit: number | null }
}

/**
 * What a completion costs, from inputs a browser already holds.
 *
 * 🛑 **This is the ONE definition of the arithmetic, and `completeBuild` calls
 * it too.** The completion form has to show the variance before the write —
 * `completeBuild` is irreversible except by a reversing build (B6) and refuses a
 * second completion (B8), so a person must see the number they are committing
 * to. Two implementations of that number, one for the preview and one for the
 * write, is exactly the drift this codebase pays for elsewhere; the preview is
 * trustworthy only because it is literally the same function.
 *
 * Every input is already rounded to whole minor units by the reads that produced
 * it, and the two derived terms round again on the way out.
 */
export function summarizeBuildCompletion(inputs: BuildCompletionInputs): BuildCompletionSummary {
  const started = unitsStarted(inputs.quantityProduced, inputs.quantityScrapped)

  let materialCost = 0
  for (const line of inputs.components) materialCost += line.extendedCost ?? 0

  const laborCost = absorbedRunCost(inputs.laborCost, inputs.rates.laborCostPerUnit, started)
  const overheadCost = absorbedRunCost(
    inputs.overheadCost,
    inputs.rates.overheadCostPerUnit,
    started
  )
  // `round(unitCost x quantity)`, never a sum of rounded units — the same rule,
  // and the same reason, as `computeExtendedCost` in the receiving module.
  const producedValue = roundMinorUnits(inputs.producedUnitCost * inputs.quantityProduced)

  return {
    materialCost,
    laborCost,
    overheadCost,
    producedValue,
    varianceAmount: buildVariance({ materialCost, laborCost, overheadCost, producedValue }),
  }
}

// ─── Client-safe re-exports of the build event's data shapes ───────────

/**
 * The four shapes a browser needs to render a completion form, re-exported so
 * `@auxx/lib/builds/client` is the one door client code goes through.
 *
 * 🛑 Client code must NEVER import from `@auxx/lib/builds` — that barrel pulls in
 * the Drizzle handlers, the realtime service and the crud stack, and a browser
 * bundle that reaches any of them fails the build. These are pure data
 * interfaces, `types.ts` imports nothing but this file, and `export type` is
 * erased entirely at build time, so this costs a browser bundle nothing at all.
 */
export type {
  AbsorptionRates,
  BuildComponentLine,
  BuildComponentOverride,
  BuildComponentPlan,
} from './types'
