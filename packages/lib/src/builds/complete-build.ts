// packages/lib/src/builds/complete-build.ts

/**
 * `completeBuild` — the ONLY function in this module that writes a stock
 * movement, and the one heavy write in the whole directory.
 *
 * plans/products/build/01-build-plan.md section 3.4, README B2/B4/B7/B8.
 *
 * ## What it produces
 *
 * ```
 * -20  400Lbs motor Assembly   @ its frozen standard cost   (build_consume)
 * +10  Auxx Lift 400lbs 4x8    @ its frozen standard cost   (build_produce)
 * ```
 *
 * That pair is the event the system could not record before this file existed,
 * and it is why margin was unavailable: not because parts had no cost, but
 * because nothing ever wrote a cost DOWN. `part_cost` is a live mirror — a
 * vendor raising the motor price in March silently restates January's COGS.
 * Every number this function writes is read from `part_standard_cost`, frozen
 * onto an append-only row, and never recomputed.
 *
 * ## The four traps, and where each is handled
 *
 * 1. **The transaction boundary.** Record-rule handlers use the module-level
 *    `database` and `publishEvent` is not awaited, so a quantity-on-hand recalc
 *    fired from inside `db.transaction()` reads a PRE-BUILD snapshot. The
 *    recalc therefore runs {@link recalculateAfterCommit}, after the
 *    transaction returns, never inside it.
 * 2. **The write lane.** One quiet session, decided in `write-lane.ts` and
 *    nowhere else. Read that file before changing it — `skipEvents: true` closes
 *    only one of the two dispatch doors.
 * 3. **Batch the recalc.** Quantity on hand is a full re-SUM per part on every
 *    movement write; a build writing 51 movements would make that 51x worse in a
 *    loop. ONE `batchRecalculateQoH` over the produced part and every consumed
 *    part. Under the quiet lane this call is the only thing recalculating them
 *    at all, so it is load-bearing rather than an optimisation.
 * 4. **`adjustSubparts: false` on every row.** The build does its own explosion.
 *    `explodeBomMovement` guards on this flag before any query, on every lane,
 *    which makes it the belt that keeps this safe if the lane ever changes.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md`
 * section 6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { Result } from 'neverthrow'
import { batchRecalculateQoH } from '../bom/qoh'
import { BadRequestError, UnprocessableEntityError } from '../errors'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { resolveInventoryRoleForPartKind } from '../receiving/client'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import {
  BuildStatus,
  StockMovementCostBasis,
  StockMovementType,
} from '../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../resources/resource-id'
import { BUILD_STATUS_BYPASS } from './build-mutations'
import {
  assertBuildStatus,
  type BuildFieldContext,
  type BuildMovementFieldContext,
  lockBuild,
  planBuildComponents,
  readPartKinds,
  requireBuildFieldContext,
  requireBuildMovementFieldContext,
} from './build-queries'
import { canCompleteBuild, resolveAbsorptionRates, summarizeBuildCompletion } from './client'
import { guard } from './guard'
import { loadAbsorptionRates, loadPartAbsorptionOverrides } from './standard-cost-queries'
import type {
  AbsorptionRates,
  BuildComponentPlan,
  BuildRecord,
  CompleteBuildInput,
  CompleteBuildResult,
} from './types'
import { buildWriteSession, publishQuietBuildWrites } from './write-lane'

const logger = createScopedLogger('builds:complete')

/**
 * Finish a run: consume the components, produce the good units, and freeze what
 * it cost.
 *
 * The order of the steps is the contract:
 *
 * 1. Re-read the build `FOR UPDATE` and refuse unless it is `planned` or
 *    `in_progress`. **B8 — one completion per build.** The lock is what makes
 *    that a rule rather than a race; a run finished in tranches is a second
 *    build.
 * 2. Resolve components with `loadDirectSubparts` — **direct only** (B4).
 * 3. Value every line at its `part_standard_cost`. **If any component has none,
 *    abort with `UnprocessableEntityError` naming the parts.** Never post a zero
 *    cost: a zero-cost consume row understates COGS, drags every downstream
 *    average toward zero, and is frozen onto an `updatable: false` row forever.
 * 4. One `build_consume` per component, at `-consumed`.
 * 5. One `build_produce` at `+quantityProduced`.
 * 6. Stamp the five cost fields and `status: 'completed'`.
 *
 * Then, and only after the transaction has committed, one batched
 * quantity-on-hand recalculation.
 */
export async function completeBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: CompleteBuildInput
): Promise<Result<CompleteBuildResult, Error>> {
  return guard(
    async () => {
      const quantityProduced = input.quantityProduced
      const quantityScrapped = input.quantityScrapped ?? 0
      assertQuantities(quantityProduced, quantityScrapped)

      const [ctx, movementCtx, orgRates] = await Promise.all([
        requireBuildFieldContext(organizationId),
        requireBuildMovementFieldContext(organizationId),
        // Read OUTSIDE the transaction: the two absorption rates are org
        // settings, they are not part of the invariant the row lock protects,
        // and reading them inside would hold the lock across a settings round
        // trip for nothing.
        //
        // ⚠️ These are the ORG rates. The produced part's own overrides are
        // applied inside `writeCompletion`, after the lock, because that is the
        // first point the produced part is known.
        loadAbsorptionRates(organizationId),
      ])

      const completedAt = input.completedAt ?? new Date()

      const written = await db.transaction(async (tx) =>
        writeCompletion(tx, organizationId, userId, {
          ctx,
          movementCtx,
          orgRates,
          input,
          quantityProduced,
          quantityScrapped,
          completedAt,
        })
      )

      // 🛑 Trap 1 and trap 3, both discharged here and NOWHERE else. Inside the
      // transaction this would re-SUM a ledger that does not yet contain the
      // rows above; per movement it would be 51 full re-SUMs.
      await recalculateAfterCommit(organizationId, written.result.recalculatedPartIds)
      publishBuildUpdate(organizationId, ctx, written.result, completedAt)
      // The ledger's own frame. `publishBuildUpdate` covers the build ROW; the
      // movement rows are silent without this and `build-ledger-card` goes on
      // rendering "Nothing posted yet" until the drawer remounts.
      publishQuietBuildWrites(organizationId, movementCtx.movementDefId, written.result.movementIds)

      logger.info('Completed build', {
        organizationId,
        buildId: written.result.buildId,
        quantityProduced,
        quantityScrapped,
        movements: written.result.movementIds.length,
        materialCost: written.result.materialCost,
        producedValue: written.result.producedValue,
        varianceAmount: written.result.varianceAmount,
      })

      return written.result
    },
    'Failed to complete build',
    { organizationId, buildId: input.buildId }
  )
}

interface WriteCompletionArgs {
  ctx: BuildFieldContext
  movementCtx: BuildMovementFieldContext
  /**
   * The two `manufacturing.*` settings. The produced part's overrides are
   * resolved onto these below, once the lock has named the part.
   */
  orgRates: AbsorptionRates
  input: CompleteBuildInput
  quantityProduced: number
  quantityScrapped: number
  completedAt: Date
}

/** Everything the post-commit work needs, plus the caller's answer. */
interface WrittenCompletion {
  build: BuildRecord
  result: CompleteBuildResult
}

/**
 * Steps 1 to 6, inside one transaction.
 *
 * `tx` is positional-first and typed as {@link Transaction} so a connection pool
 * cannot typecheck into the slot: every write below must land or none of them
 * must, and a pool here would write a half-build that no reversal can describe.
 */
async function writeCompletion(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: WriteCompletionArgs
): Promise<WrittenCompletion> {
  const { ctx, movementCtx, orgRates, input, quantityProduced, quantityScrapped, completedAt } =
    args
  const txDb = tx as unknown as Database

  // Step 1. The lock IS B8's enforcement — see `lockBuild`.
  const build = await lockBuild(tx, organizationId, ctx, input.buildId)
  assertBuildStatus(
    build,
    canCompleteBuild,
    'This build has already been completed or cancelled. A run finished in tranches is a second build.'
  )
  if (!build.partId) {
    throw new UnprocessableEntityError('This build names no part and cannot be completed')
  }

  // Steps 2 and 3.
  const plan = await planBuildComponents(txDb, organizationId, {
    partId: build.partId,
    quantityProduced,
    quantityScrapped,
    componentOverrides: input.componentOverrides,
  })
  assertPlanIsPostable(plan)

  // Non-null by construction: `assertPlanIsPostable` refuses a plan whose
  // produced part has no standard, which is the same "never post a zero cost"
  // rule seen from the other side. Re-checked rather than cast, because a cast
  // would silently survive somebody weakening that assertion.
  const producedUnitCost = plan.producedUnitCost
  if (producedUnitCost == null) {
    throw new UnprocessableEntityError(
      'Refusing to complete a build at zero cost: roll the standard cost for the produced part first'
    )
  }

  // 🛑 The rates this RUN absorbs must be the same ones the produced part's
  // frozen standard was rolled from, or the variance stops closing to zero and
  // the difference lands in 5090 on `updatable: false` rows, on every single
  // completion. Read on `txDb` so it is the same snapshot `planBuildComponents`
  // took its standard costs from, and read here rather than outside the
  // transaction because `build.partId` does not exist until `lockBuild` returns.
  const rates = resolveAbsorptionRates(
    orgRates,
    await loadPartAbsorptionOverrides(txDb, organizationId, build.partId)
  )

  // 🛑 The SAME function the completion form runs to preview these five numbers
  // (`client.ts`). The form has to show the variance before the write, because a
  // completion is irreversible except by a reversing build (B6) and refuses a
  // second attempt (B8) — and a preview computed by a second implementation is
  // only accidentally the number that gets stored.
  const { materialCost, laborCost, overheadCost, producedValue, varianceAmount } =
    summarizeBuildCompletion({
      components: plan.components,
      producedUnitCost,
      quantityProduced,
      quantityScrapped,
      laborCost: input.laborCost,
      overheadCost: input.overheadCost,
      rates,
    })

  const producedKinds = await readPartKinds(txDb, organizationId, [build.partId])
  const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
    // The one construction site for the quiet lane. See `write-lane.ts`.
    session: buildWriteSession(),
    // 🛑 Step 6 writes `build_status: 'completed'`, which
    // `field-hooks/pre/build-status-guard.ts` refuses on a manual write. Without this the
    // wall built to protect the ledger would refuse the only function that writes it.
    // ⚠️ The movement `create`s below share this handler and so inherit the set; that is
    // safe only because it names `build_status` alone and `stock_movement` has no such
    // attribute.
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })

  const buildRecordId = toRecordId(ctx.buildDefId, build.buildId)
  const movementIds: string[] = []

  // Step 4: one `build_consume` per component, at the NEGATED quantity.
  for (const line of plan.components) {
    const values: Record<string, unknown> = {
      stock_movement_part: toRecordId(movementCtx.partDefId, line.partId),
      stock_movement_type: StockMovementType.BUILD_CONSUME,
      stock_movement_quantity: -line.quantityConsumed,
      // See the file header, trap 4. Never true on a build row.
      stock_movement_adjust_subparts: false,
      stock_movement_build: buildRecordId,
      stock_movement_unit_cost: line.unitCost,
      // Negated from the POSITIVE extended cost the plan computed, so the row
      // and `materialCost` cannot disagree by a rounding step. Deriving it from
      // `round(unitCost x -consumed)` instead would differ on a half-cent tail,
      // because `Math.round` breaks ties toward positive infinity.
      stock_movement_extended_cost: -(line.extendedCost ?? 0),
      stock_movement_gl_account: line.glAccount,
      stock_movement_cost_basis: StockMovementCostBasis.STANDARD,
      stock_movement_occurred_at: completedAt.toISOString(),
    }
    // NULL is the OFF-BOM marker and is written as an absence, not a zero: a
    // stamped `0` would claim the bill of materials calls for none of this
    // component, which is a different and false statement.
    if (line.qtyPerUnit != null) values.stock_movement_qty_per_unit = line.qtyPerUnit

    const created = await crud.create(movementCtx.movementDefId, values)
    movementIds.push(created.instance.id)
  }

  // Step 5: the single `build_produce`.
  //
  // ⚠️ The account is resolved from the produced part's OWN `part_kind`, not
  // hard-coded to 1330. Section 3.4 names 1330 because the case it describes is
  // a finished good, and for a finished good this resolves to exactly that. A
  // SUBASSEMBLY build stamped 1330 would put raw-materials stock into Finished
  // Goods, contradicting the part-kind account map that receiving already uses
  // (products/01 section 4) and overstating 1330 on every subassembly run.
  const produceValues: Record<string, unknown> = {
    stock_movement_part: toRecordId(movementCtx.partDefId, build.partId),
    stock_movement_type: StockMovementType.BUILD_PRODUCE,
    // 🛑 `quantityProduced`, never `unitsStarted`. B7: scrapped units consume
    // material and produce NO movement. Their cost falls out in
    // `varianceAmount` instead of being absorbed into the survivors, because
    // absorbing it would give the same variant a different unit cost on every
    // run and destroy the point of a standard.
    stock_movement_quantity: quantityProduced,
    stock_movement_adjust_subparts: false,
    stock_movement_build: buildRecordId,
    stock_movement_unit_cost: producedUnitCost,
    stock_movement_extended_cost: producedValue,
    stock_movement_gl_account: resolveInventoryRoleForPartKind(
      producedKinds.get(build.partId) ?? null
    ),
    stock_movement_cost_basis: StockMovementCostBasis.STANDARD,
    stock_movement_occurred_at: completedAt.toISOString(),
  }
  const produce = await crud.create(movementCtx.movementDefId, produceValues)
  movementIds.push(produce.instance.id)

  // Step 6.
  const buildValues: Record<string, unknown> = {
    build_status: BuildStatus.COMPLETED,
    build_quantity_produced: quantityProduced,
    build_quantity_scrapped: quantityScrapped,
    build_material_cost: materialCost,
    build_labor_cost: laborCost,
    build_overhead_cost: overheadCost,
    build_produced_value: producedValue,
    build_variance_amount: varianceAmount,
    build_completed_at: completedAt.toISOString(),
  }
  if (input.notes && ctx.fields.build_notes) {
    buildValues.build_notes = build.notes ? `${build.notes}\n${input.notes}` : input.notes
  }
  await crud.update(buildRecordId as RecordId, buildValues)

  return {
    build,
    result: {
      buildId: build.buildId,
      recordId: buildRecordId,
      quantityProduced,
      quantityScrapped,
      materialCost,
      laborCost,
      overheadCost,
      producedValue,
      varianceAmount,
      movementIds,
      recalculatedPartIds: [build.partId, ...plan.components.map((line) => line.partId)],
    },
  }
}

/**
 * ONE batched recalculation, after the commit.
 *
 * Extracted so the ordering is a named step a test can assert against rather
 * than a line in the middle of a long function. See traps 1 and 3.
 */
export async function recalculateAfterCommit(
  organizationId: string,
  partIds: string[]
): Promise<void> {
  await batchRecalculateQoH(organizationId, [...new Set(partIds)])
}

/**
 * Refuse a plan that cannot be valued, naming the parts.
 *
 * 🛑 **Never post a zero cost.** `readStandardCost` omits a part that has never
 * been rolled rather than defaulting it, precisely so this check can exist: a
 * missing standard is a refusal, not a zero. The two failure modes it prevents
 * are the same failure seen from either end — an unvalued consume row
 * understates COGS forever, and an unvalued produce row creates inventory at
 * nothing.
 */
function assertPlanIsPostable(plan: BuildComponentPlan): void {
  if (plan.components.length === 0) {
    throw new UnprocessableEntityError(
      'This build has no components to consume. Add a bill of materials, or record a stock adjustment instead.'
    )
  }
  if (plan.missingStandardPartIds.length > 0) {
    throw new UnprocessableEntityError(
      'Refusing to complete a build at zero cost: roll the standard cost for these parts first',
      { partIds: plan.missingStandardPartIds }
    )
  }
}

/**
 * The two quantity rules, checked before anything is read.
 *
 * A zero-unit completion is refused rather than treated as a no-op: it would
 * write a full set of consume rows against a produce row of nothing, which is a
 * scrap event wearing a build's clothes. Negative scrap is refused because it
 * would silently REDUCE the material consumed below what the bill of materials
 * calls for.
 */
function assertQuantities(quantityProduced: number, quantityScrapped: number): void {
  if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    throw new BadRequestError('A completed build must produce at least one unit')
  }
  if (!Number.isFinite(quantityScrapped) || quantityScrapped < 0) {
    throw new BadRequestError('Scrapped units cannot be negative')
  }
}

/**
 * Push the completed build's own numbers to every open client.
 *
 * The quiet lane deliberately suppresses the per-write realtime frame for
 * everything this function writes, which is right for 51 movement rows and
 * wrong for the build row itself: without this the list and the detail page
 * would keep rendering `planned` with empty costs until a reload. Fire and
 * forget, after the commit, exactly as the standard-cost roll publishes.
 */
function publishBuildUpdate(
  organizationId: string,
  ctx: BuildFieldContext,
  result: CompleteBuildResult,
  completedAt: Date
): void {
  const entries: FieldValueUpdateEntry[] = []
  const push = (field: { id: string } | null, value: unknown) => {
    if (!field) return
    entries.push({
      key: buildFieldValueKey(result.recordId as RecordId, field.id as FieldId),
      value,
    })
  }

  push(ctx.fields.build_status, { type: 'option', optionId: BuildStatus.COMPLETED })
  push(ctx.fields.build_quantity_produced, { type: 'number', value: result.quantityProduced })
  push(ctx.fields.build_quantity_scrapped, { type: 'number', value: result.quantityScrapped })
  push(ctx.fields.build_material_cost, { type: 'number', value: result.materialCost })
  push(ctx.fields.build_labor_cost, { type: 'number', value: result.laborCost })
  push(ctx.fields.build_overhead_cost, { type: 'number', value: result.overheadCost })
  push(ctx.fields.build_produced_value, { type: 'number', value: result.producedValue })
  push(ctx.fields.build_variance_amount, { type: 'number', value: result.varianceAmount })
  push(ctx.fields.build_completed_at, { type: 'date', value: completedAt.toISOString() })

  if (entries.length === 0) return
  publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
}
