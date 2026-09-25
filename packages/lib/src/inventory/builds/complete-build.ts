// packages/lib/src/inventory/builds/complete-build.ts

/**
 * `completeBuild` - the ONLY function in this module that writes a stock
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
 * because nothing ever wrote a cost DOWN. `part_cost` is a live mirror - a
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
 *    nowhere else. Read that file before changing it - `skipEvents: true` closes
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
import type { InventoryMovementLine } from '../../accounting/ledger/builders/inventory-movement'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  exportInventoryMovement,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import { upsertWorkItem } from '../../accounting/work-items/write'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import {
  BuildStatus,
  StockMovementCostBasis,
  StockMovementType,
} from '../../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { isServicePartKind } from '../costing/client'
import { batchRecalculateQoH } from '../costing/qoh'
import { loadPartAbsorptionRates } from '../costing/standard-cost-queries'
import { type StockMovementInput, writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { BUILD_STATUS_BYPASS } from './build-mutations'
import {
  assertBuildStatus,
  type BuildContext,
  type BuildMovementContext,
  lockBuild,
  planBuildComponents,
  readPartKinds,
  requireBuildContext,
  requireBuildMovementContext,
} from './build-queries'
import { canCompleteBuild, summarizeBuildCompletion } from './client'
import { guard } from './guard'
import type {
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
 *    `in_progress`. **B8 - one completion per build.** The lock is what makes
 *    that a rule rather than a race; a run finished in tranches is a second
 *    build.
 * 2. Resolve components with `loadDirectSubparts` - **direct only** (B4).
 * 3. Value every line at its `part_standard_cost`. A leg whose part has none is
 *    written `pending` with no cost (111 Q18) - never a zero, which understates
 *    COGS and drags every downstream average toward zero. While any leg is
 *    pending the build's entry is NOT posted (its subject is the build id and
 *    can be claimed once, 73-D11) and the build parks at stage `price`.
 * 4. One `build_consume` per component, at `-consumed`.
 * 5. One `build_produce` at `+quantityProduced`.
 * 6. Stamp the five cost fields and `status: 'completed'`; a pending build
 *    stamps the status alone and the pricer stamps the costs on the last leg.
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

      const [ctx, movementCtx] = await Promise.all([
        requireBuildContext(organizationId),
        requireBuildMovementContext(organizationId),
      ])

      const completedAt = input.completedAt ?? new Date()

      const written = await db.transaction(async (tx) =>
        writeCompletion(tx, organizationId, userId, {
          ctx,
          movementCtx,
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
      await exportInventoryMovement(db, written.post)
      await parkPendingBuild(db, organizationId, written)
      publishBuildUpdate(organizationId, ctx, written.result, completedAt)
      // The ledger's own frame. `publishBuildUpdate` covers the build ROW; the
      // movement rows are silent without this and `build-ledger-card` goes on
      // rendering "Nothing posted yet" until the drawer remounts.
      publishQuietBuildWrites(organizationId, movementCtx.defId, written.result.movementIds)

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
  ctx: BuildContext
  movementCtx: BuildMovementContext
  input: CompleteBuildInput
  quantityProduced: number
  quantityScrapped: number
  completedAt: Date
}

/** Everything the post-commit work needs, plus the caller's answer. */
interface WrittenCompletion {
  build: BuildRecord
  result: CompleteBuildResult
  /** The build's own inventory entry, awaiting its export. `null` on a pending build. */
  post: InTxPostResult | null
  /** The legs written `pending`, and the name of the first uncosted part, for the park. */
  pendingMovementIds: string[]
  pendingPartName: string | null
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
  const { ctx, movementCtx, input, quantityProduced, quantityScrapped, completedAt } = args
  const txDb = tx as unknown as Database

  // Step 1. The lock IS B8's enforcement - see `lockBuild`.
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
  // 111 Q18: any leg without a standard makes the WHOLE build pending. Its entry
  // is one document claimed once by the build id, so a partial entry now would
  // collide with the priced one later (73-D11).
  const pendingPartIds = plan.missingStandardPartIds
  const pending = pendingPartIds.length > 0
  const producedUnitCost = plan.producedUnitCost

  // 🛑 The rates this RUN absorbs must be the same ones the produced part's
  // frozen standard was rolled from, or the variance stops closing to zero and
  // the difference lands in 5090 on `updatable: false` rows, on every single
  // completion. Read on `txDb` so it is the same snapshot `planBuildComponents`
  // took its standard costs from, and read here rather than outside the
  // transaction because `build.partId` does not exist until `lockBuild` returns.
  const rates = await loadPartAbsorptionRates(txDb, organizationId, build.partId)

  // 🛑 The SAME function the completion form runs to preview these five numbers
  // (`client.ts`). The form has to show the variance before the write, because a
  // completion is irreversible except by a reversing build (B6) and refuses a
  // second attempt (B8) - and a preview computed by a second implementation is
  // only accidentally the number that gets stored. A pending build has no
  // summary yet: the pricer computes and stamps it when the last leg is priced.
  const summary =
    producedUnitCost != null && !pending
      ? summarizeBuildCompletion({
          components: plan.components,
          producedUnitCost,
          quantityProduced,
          quantityScrapped,
          laborCost: input.laborCost,
          overheadCost: input.overheadCost,
          rates,
        })
      : null

  const producedKinds = await readPartKinds(txDb, organizationId, [build.partId])
  if (isServicePartKind(producedKinds.get(build.partId))) {
    throw new BadRequestError('A service is not stocked, so it cannot be built')
  }
  // The one construction site for the quiet lane. See `write-lane.ts`.
  const buildSession = buildWriteSession()
  const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
    session: buildSession,
    // 🛑 Step 6 writes `build_status: 'completed'`, which
    // `field-hooks/pre/build-status-guard.ts` refuses on a manual write. Without this the
    // wall built to protect the ledger would refuse the only function that writes it.
    // ⚠️ `stock-movements.writeStockMovements` below is handed the same session and the
    // same `bypassFieldGuards` set (the shared `movementLane` object), and that is safe
    // only because it names `build_status` alone and `stock_movement` has no such
    // attribute.
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })
  const movementLane = {
    kind: 'quiet' as const,
    session: buildSession,
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  }
  const movementCtxArgs = {
    db: txDb,
    organizationId,
    userId,
    movementDefId: movementCtx.defId,
    partDefId: movementCtx.partDefId,
    lane: movementLane,
    // The SAME handler `crud.update` below writes `build_status` through -
    // `build-event.test.ts` pins exactly one quiet-lane `UnifiedCrudHandler`
    // construction per completion. See `StockMovementsCtx.handler`.
    handler: crud,
  }

  const buildRecordId = toRecordId(ctx.defId, build.buildId)

  // Step 4: one `build_consume` per component, at the NEGATED quantity, through
  // the shared `stock-movements.writeStockMovements`
  // (plans/money/tasks/50-batch-inventory-relief.md §2).
  const consumeInputs: StockMovementInput[] = plan.components.map((line) => ({
    partInstanceId: line.partId,
    type: StockMovementType.BUILD_CONSUME,
    quantity: -line.quantityConsumed,
    // `null` on a component with no standard: the leg is written pending (111 Q18).
    unitCost: line.unitCost,
    // Negated from the POSITIVE extended cost the plan computed, so the row
    // and `materialCost` cannot disagree by a rounding step. Deriving it from
    // `round(unitCost x -consumed)` instead would differ on a half-cent tail,
    // because `Math.round` breaks ties toward positive infinity - the ONE
    // documented `extendedCost` override (50 §2.2). Absent, never 0, on a
    // pending leg.
    extendedCost: line.extendedCost == null ? undefined : -line.extendedCost,
    glAccount: line.glAccount,
    costBasis:
      line.unitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
    occurredAt: completedAt,
    // NULL is the OFF-BOM marker and is written as an absence, not a zero: a
    // stamped `0` would claim the bill of materials calls for none of this
    // component, which is a different and false statement.
    qtyPerUnit: line.qtyPerUnit,
    links: { buildId: buildRecordId },
  }))

  const consumeWritten = await writeStockMovements(movementCtxArgs, consumeInputs)
  if (consumeWritten.isErr()) throw consumeWritten.error

  // Step 5: the single `build_produce`.
  //
  // ⚠️ The account is resolved from the produced part's OWN `part_kind`, not
  // hard-coded to 1330, and - load-bearing for
  // `complete-build-transaction.int.test.ts` - resolved HERE, after every
  // consume row above has already been written. Section 3.4 names 1330
  // because the case it describes is a finished good, and for a finished good
  // this resolves to exactly that. A SUBASSEMBLY build stamped 1330 would put
  // raw-materials stock into Finished Goods, contradicting the part-kind
  // account map that receiving already uses (products/01 section 4) and
  // overstating 1330 on every subassembly run.
  const produceGlAccount = resolveInventoryRoleForPartKind(producedKinds.get(build.partId) ?? null)

  const produceInputs: StockMovementInput[] = [
    {
      partInstanceId: build.partId,
      type: StockMovementType.BUILD_PRODUCE,
      // 🛑 `quantityProduced`, never `unitsStarted`. B7: scrapped units consume
      // material and produce NO movement. Their cost falls out in
      // `varianceAmount` instead of being absorbed into the survivors, because
      // absorbing it would give the same variant a different unit cost on
      // every run and destroy the point of a standard.
      quantity: quantityProduced,
      unitCost: producedUnitCost,
      extendedCost: summary?.producedValue,
      glAccount: produceGlAccount,
      costBasis:
        producedUnitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
      occurredAt: completedAt,
      links: { buildId: buildRecordId },
    },
  ]

  const produceWritten = await writeStockMovements(movementCtxArgs, produceInputs)
  if (produceWritten.isErr()) throw produceWritten.error

  // Consumes first then the single produce - `CompleteBuildResult.movementIds`
  // documents that order.
  const movementIds = [
    ...consumeWritten.value.records.map((record) => record.movementId),
    ...produceWritten.value.records.map((record) => record.movementId),
  ]

  // Step 6. The five cost fields wait for the pricer on a pending build.
  const buildValues: Record<string, unknown> = {
    build_status: BuildStatus.COMPLETED,
    build_quantity_produced: quantityProduced,
    build_quantity_scrapped: quantityScrapped,
    build_completed_at: completedAt.toISOString(),
  }
  if (summary) {
    buildValues.build_material_cost = summary.materialCost
    buildValues.build_labor_cost = summary.laborCost
    buildValues.build_overhead_cost = summary.overheadCost
    buildValues.build_produced_value = summary.producedValue
    buildValues.build_variance_amount = summary.varianceAmount
  }
  if (input.notes && ctx.fields.build_notes) {
    buildValues.build_notes = build.notes ? `${build.notes}\n${input.notes}` : input.notes
  }
  await crud.update(buildRecordId as RecordId, buildValues)

  // The build's own entry, inside the completion's transaction: consumes and
  // produces move between the three inventory accounts, the absorbed labour and
  // overhead come out of their pools, and the residual is the run's variance.
  // A pending build posts nothing here; the pricer posts it once every leg is priced.
  const writtenRecords = [...consumeWritten.value.records, ...produceWritten.value.records]
  const movementLines: InventoryMovementLine[] = writtenRecords
    .filter(
      (record) => record.glAccount && record.extendedCost != null && record.extendedCost !== 0
    )
    .map((record) => ({
      id: record.movementId,
      extendedCostMinor: record.extendedCost as number,
      glAccountRole: record.glAccount as string,
    }))
  const post = summary
    ? await postInventoryMovementInTx(tx, {
        organizationId,
        kind: 'build',
        subject: { sourceKind: 'build', sourceId: build.buildId },
        ...(build.orderId ? { parents: [{ sourceKind: 'order', sourceId: build.orderId }] } : {}),
        occurredAt: completedAt,
        movements: movementLines,
        absorbed: { laborMinor: summary.laborCost, overheadMinor: summary.overheadCost },
        actorUserId: userId,
      })
    : null

  const firstPendingPartId = pendingPartIds[0]
  return {
    build,
    post,
    pendingMovementIds: writtenRecords
      .filter((record) => record.unitCost == null)
      .map((record) => record.movementId),
    pendingPartName:
      plan.components.find((line) => line.partId === firstPendingPartId)?.partName ?? null,
    result: {
      buildId: build.buildId,
      recordId: buildRecordId,
      quantityProduced,
      quantityScrapped,
      materialCost: summary?.materialCost ?? null,
      laborCost: summary?.laborCost ?? null,
      overheadCost: summary?.overheadCost ?? null,
      producedValue: summary?.producedValue ?? null,
      varianceAmount: summary?.varianceAmount ?? null,
      pendingPartIds,
      movementIds,
      // §2.4 item 3: RETURNED by every `writeStockMovements` call, not
      // re-derived - the quiet lane's recalc obligation is then structural
      // rather than something this file has to remember to keep in sync with
      // what was actually written.
      recalculatedPartIds: [
        ...new Set([
          ...consumeWritten.value.affectedPartIds,
          ...produceWritten.value.affectedPartIds,
        ]),
      ],
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
 * Refuse a plan that consumes nothing.
 *
 * A missing standard is no longer a refusal: `readStandardCost` omits a part with no usable
 * standard, and such a leg is written `pending` (111 Q18). A deliberate $0 standard (103 §5a) is
 * present and builds at $0.
 */
function assertPlanIsPostable(plan: BuildComponentPlan): void {
  if (plan.components.length === 0) {
    throw new UnprocessableEntityError(
      'This build has no components to consume. Add a bill of materials, or record a stock adjustment instead.'
    )
  }
}

/** The Blocked surface for a pending build: one `price` item, grouped by the first uncosted part. */
async function parkPendingBuild(
  db: Database,
  organizationId: string,
  written: WrittenCompletion
): Promise<void> {
  const partId = written.result.pendingPartIds[0]
  if (!partId) return
  await upsertWorkItem(db, organizationId, {
    sourceKind: 'build',
    sourceId: written.result.buildId,
    stage: 'price',
    reasonCode: 'STANDARD_COST_MISSING',
    externalRef: partId,
    detail: {
      partIds: written.result.pendingPartIds,
      pendingMovementIds: written.pendingMovementIds,
      ...(written.pendingPartName ? { partName: written.pendingPartName } : {}),
    },
  })
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
  ctx: BuildContext,
  result: CompleteBuildResult,
  completedAt: Date
): void {
  const entries: FieldValueUpdateEntry[] = []
  const push = (field: { id: string } | null, value: Record<string, unknown>) => {
    // A pending build has no cost figures yet; nothing to push for them.
    if (!field || ('value' in value && value.value == null)) return
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
