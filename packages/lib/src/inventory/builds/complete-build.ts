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
import { flushInstanceDerived } from '../../field-values/instance-derived'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { WriteSession } from '../../resources/crud/write-origin'
import {
  BuildStatus,
  StockMovementCostBasis,
  StockMovementType,
} from '../../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { isServicePartKind } from '../costing/client'
import { batchRecalculateQoH } from '../costing/qoh'
import { loadPartAbsorptionRates } from '../costing/standard-cost-queries'
import {
  type StockMovementInput,
  type WriteStockMovementsResult,
  writeStockMovementsBatch,
} from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { BUILD_STATUS_BYPASS, raiseBuildValues } from './build-mutations'
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
import {
  absorbedRunCost,
  type BuildCompletionSummary,
  canCompleteBuild,
  summarizeBuildCompletion,
  unitsStarted,
} from './client'
import { guard } from './guard'
import type { BuildComponentPlan, CompleteBuildInput, CompleteBuildResult } from './types'
import { buildCompletionSession, publishQuietBuildWrites } from './write-lane'

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
 *    stamps status, labour and overhead, and `price-build.ts` stamps the rest
 *    once the last leg is priced.
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

      await finishCompletion(db, organizationId, { ctx, movementCtx, written, completedAt })
      return written.result
    },
    'Failed to complete build',
    { organizationId, buildId: input.buildId }
  )
}

/** Everything a completion does after its transaction commits; shared with `recordCompletedBuild`. */
async function finishCompletion(
  db: Database,
  organizationId: string,
  args: {
    ctx: BuildContext
    movementCtx: BuildMovementContext
    written: WrittenCompletion
    completedAt: Date
  }
): Promise<void> {
  const { ctx, movementCtx, written, completedAt } = args
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
  // The covered lane sends no inverse frames: the parts' and the build's movement lists.
  publishQuietBuildWrites(organizationId, movementCtx.partDefId, written.result.recalculatedPartIds)
  publishQuietBuildWrites(organizationId, ctx.defId, [written.result.buildId])

  logger.info('Completed build', {
    organizationId,
    buildId: written.result.buildId,
    quantityProduced: written.result.quantityProduced,
    quantityScrapped: written.result.quantityScrapped,
    movements: written.result.movementIds.length,
    materialCost: written.result.materialCost,
    producedValue: written.result.producedValue,
    varianceAmount: written.result.varianceAmount,
  })
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
  result: CompleteBuildResult
  /** The build's own inventory entry, awaiting its export. `null` on a pending build. */
  post: InTxPostResult | null
  /** The legs written `pending`, and the name of the first uncosted part, for the park. */
  pendingMovementIds: string[]
  pendingPartName: string | null
}

/** Steps 2 and 3 plus the run's absorbed costs: everything the writes need, read on `tx`. */
interface PricedCompletion {
  plan: BuildComponentPlan
  pendingPartIds: string[]
  summary: BuildCompletionSummary | null
  /** The produced part's inventory role, from its own `part_kind`. */
  produceGlAccount: string
  laborCost: number
  overheadCost: number
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

  const priced = await priceCompletion(txDb, organizationId, {
    partId: build.partId,
    quantityProduced,
    quantityScrapped,
    componentOverrides: input.componentOverrides,
    laborCost: input.laborCost,
    overheadCost: input.overheadCost,
  })

  // The one construction site for the quiet lane. See `write-lane.ts`.
  const session = buildCompletionSession()
  // 🛑 Step 6 writes `build_status: 'completed'`, which `build-status-guard.ts` refuses on a
  // manual write; the bypass names `build_status` alone, so it is inert on the movement rows.
  const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
    session,
    bypassFieldGuards: BUILD_STATUS_BYPASS,
  })
  const buildRecordId = toRecordId(ctx.defId, build.buildId)
  const movements = await writeCompletionMovements(txDb, organizationId, userId, {
    movementCtx,
    session,
    priced,
    buildRecordId,
    quantityProduced,
    completedAt,
  })

  // Step 6. On a pending build only labour and overhead are stamped; `price-build.ts` stamps the rest.
  const buildValues = completionBuildValues(priced, {
    quantityProduced,
    quantityScrapped,
    completedAt,
  })
  if (input.notes && ctx.fields.build_notes) {
    buildValues.build_notes = build.notes ? `${build.notes}\n${input.notes}` : input.notes
  }
  await crud.update(buildRecordId as RecordId, buildValues)

  return postCompletion(tx, organizationId, userId, {
    buildId: build.buildId,
    orderId: build.orderId,
    buildRecordId,
    priced,
    movements,
    quantityProduced,
    quantityScrapped,
    completedAt,
  })
}

/** Steps 2 and 3: the plan, the absorption rates, the summary and the produce account. */
async function priceCompletion(
  txDb: Database,
  organizationId: string,
  args: {
    partId: string
    quantityProduced: number
    quantityScrapped: number
    componentOverrides?: CompleteBuildInput['componentOverrides']
    laborCost?: number
    overheadCost?: number
  }
): Promise<PricedCompletion> {
  const { partId, quantityProduced, quantityScrapped } = args
  const plan = await planBuildComponents(txDb, organizationId, {
    partId,
    quantityProduced,
    quantityScrapped,
    componentOverrides: args.componentOverrides,
  })
  assertPlanIsPostable(plan)
  // 111 Q18: any leg without a standard makes the WHOLE build pending. Its entry
  // is one document claimed once by the build id, so a partial entry now would
  // collide with the priced one later (73-D11).
  const pendingPartIds = plan.missingStandardPartIds
  const producedUnitCost = plan.producedUnitCost

  // 🛑 The rates this RUN absorbs must be the same ones the produced part's
  // frozen standard was rolled from, or the variance stops closing to zero and
  // the difference lands in 5090 on `updatable: false` rows, on every single
  // completion. Read on `txDb` so it is the same snapshot `planBuildComponents`
  // took its standard costs from.
  const rates = await loadPartAbsorptionRates(txDb, organizationId, partId)

  // 🛑 The SAME function the completion form runs to preview these five numbers
  // (`client.ts`): a preview computed by a second implementation is only
  // accidentally the number that gets stored. A pending build has no summary
  // yet: the pricer computes and stamps it when the last leg is priced.
  const summary =
    producedUnitCost != null && pendingPartIds.length === 0
      ? summarizeBuildCompletion({
          components: plan.components,
          producedUnitCost,
          quantityProduced,
          quantityScrapped,
          laborCost: args.laborCost,
          overheadCost: args.overheadCost,
          rates,
        })
      : null

  const producedKinds = await readPartKinds(txDb, organizationId, [partId])
  if (isServicePartKind(producedKinds.get(partId))) {
    throw new BadRequestError('A service is not stocked, so it cannot be built')
  }

  const started = unitsStarted(quantityProduced, quantityScrapped)
  return {
    plan,
    pendingPartIds,
    summary,
    // From the produced part's OWN `part_kind`, not hard-coded to 1330: a subassembly
    // stamped 1330 would put raw-materials stock into Finished Goods.
    produceGlAccount: resolveInventoryRoleForPartKind(producedKinds.get(partId) ?? null),
    laborCost: absorbedRunCost(args.laborCost, rates.laborCostPerUnit, started),
    overheadCost: absorbedRunCost(args.overheadCost, rates.overheadCostPerUnit, started),
  }
}

/**
 * Steps 4 and 5 in one batched write: one `build_consume` per component at the NEGATED
 * quantity, then the single `build_produce`. `CompleteBuildResult.movementIds` keeps that order.
 */
async function writeCompletionMovements(
  txDb: Database,
  organizationId: string,
  userId: string,
  args: {
    movementCtx: BuildMovementContext
    session: WriteSession
    priced: PricedCompletion
    buildRecordId: RecordId
    quantityProduced: number
    completedAt: Date
  }
): Promise<WriteStockMovementsResult> {
  const { movementCtx, priced, buildRecordId, completedAt } = args
  const consumeInputs: StockMovementInput[] = priced.plan.components.map((line) => ({
    partInstanceId: line.partId,
    type: StockMovementType.BUILD_CONSUME,
    quantity: -line.quantityConsumed,
    // `null` on a component with no standard: the leg is written pending (111 Q18).
    unitCost: line.unitCost,
    // Negated from the plan's POSITIVE extended cost so the row and `materialCost` cannot
    // disagree by a rounding step (`Math.round` breaks ties toward +infinity). Absent on a
    // pending leg.
    extendedCost: line.extendedCost == null ? undefined : -line.extendedCost,
    glAccount: line.glAccount,
    costBasis:
      line.unitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
    occurredAt: completedAt,
    // NULL is the OFF-BOM marker, written as an absence: a stamped 0 would claim the BOM
    // calls for none of this component.
    qtyPerUnit: line.qtyPerUnit,
    links: { buildId: buildRecordId },
  }))
  const produceUnitCost = priced.plan.producedUnitCost
  const produceInput: StockMovementInput = {
    partInstanceId: priced.plan.partId,
    type: StockMovementType.BUILD_PRODUCE,
    // 🛑 `quantityProduced`, never `unitsStarted` (B7): scrapped units consume material and
    // produce nothing; their cost falls out in `varianceAmount`.
    quantity: args.quantityProduced,
    unitCost: produceUnitCost,
    extendedCost: priced.summary?.producedValue,
    glAccount: priced.produceGlAccount,
    costBasis:
      produceUnitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
    occurredAt: completedAt,
    links: { buildId: buildRecordId },
  }

  const written = await writeStockMovementsBatch(
    {
      db: txDb,
      organizationId,
      userId,
      movementDefId: movementCtx.defId,
      partDefId: movementCtx.partDefId,
      lane: { kind: 'quiet', session: args.session, bypassFieldGuards: BUILD_STATUS_BYPASS },
    },
    [...consumeInputs, produceInput]
  )
  if (written.isErr()) throw written.error
  return written.value
}

/** The status and cost fields a completion stamps on its build. */
function completionBuildValues(
  priced: PricedCompletion,
  run: { quantityProduced: number; quantityScrapped: number; completedAt: Date }
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    build_status: BuildStatus.COMPLETED,
    build_quantity_produced: run.quantityProduced,
    build_quantity_scrapped: run.quantityScrapped,
    build_completed_at: run.completedAt.toISOString(),
    build_labor_cost: priced.laborCost,
    build_overhead_cost: priced.overheadCost,
  }
  if (priced.summary) {
    values.build_material_cost = priced.summary.materialCost
    values.build_produced_value = priced.summary.producedValue
    values.build_variance_amount = priced.summary.varianceAmount
  }
  return values
}

/**
 * The build's own entry, inside the completion's transaction: consumes and produces move between
 * the inventory accounts, absorbed labour and overhead come out of their pools, and the residual
 * is the run's variance. A pending build posts nothing; the pricer posts it once every leg is priced.
 */
async function postCompletion(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: {
    buildId: string
    orderId: string | null
    buildRecordId: RecordId
    priced: PricedCompletion
    movements: WriteStockMovementsResult
    quantityProduced: number
    quantityScrapped: number
    completedAt: Date
  }
): Promise<WrittenCompletion> {
  const { buildId, orderId, priced, movements, completedAt } = args
  const { summary, pendingPartIds } = priced
  const movementLines: InventoryMovementLine[] = movements.records
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
        subject: { sourceKind: 'build', sourceId: buildId },
        ...(orderId ? { parents: [{ sourceKind: 'order', sourceId: orderId }] } : {}),
        occurredAt: completedAt,
        movements: movementLines,
        absorbed: { laborMinor: summary.laborCost, overheadMinor: summary.overheadCost },
        actorUserId: userId,
      })
    : null

  const firstPendingPartId = pendingPartIds[0]
  return {
    post,
    pendingMovementIds: movements.records
      .filter((record) => record.unitCost == null)
      .map((record) => record.movementId),
    pendingPartName:
      priced.plan.components.find((line) => line.partId === firstPendingPartId)?.partName ?? null,
    result: {
      buildId,
      recordId: args.buildRecordId,
      quantityProduced: args.quantityProduced,
      quantityScrapped: args.quantityScrapped,
      materialCost: summary?.materialCost ?? null,
      laborCost: priced.laborCost,
      overheadCost: priced.overheadCost,
      producedValue: summary?.producedValue ?? null,
      varianceAmount: summary?.varianceAmount ?? null,
      pendingPartIds,
      movementIds: movements.records.map((record) => record.movementId),
      // Returned by the writer, not re-derived: the quiet lane's recalc obligation is structural.
      recalculatedPartIds: movements.affectedPartIds,
    },
  }
}

/** What {@link recordCompletedBuild} is handed: one build, completed at its caller's date. */
export interface RecordCompletedBuildInput {
  partId: string
  quantity: number
  source: 'batch' | 'backflush'
  /** The run's number, allocated once by the caller and shared by every build it raises. */
  batchRun: number
  completedAt: Date
  period?: { start: Date; end: Date }
  notes?: string
}

/**
 * Raise, start and complete a build in ONE transaction, for the batch writers (backfill,
 * backflush): the same values `createBuild` + `startBuild` + `completeBuild` store, but a refused
 * completion leaves no build behind. See plans/mrp/10-batched-build-writes.md §4.
 */
export async function recordCompletedBuild(
  db: Database,
  organizationId: string,
  userId: string,
  input: RecordCompletedBuildInput
): Promise<Result<CompleteBuildResult, Error>> {
  return guard(
    async () => {
      assertQuantities(input.quantity, 0)
      const [ctx, movementCtx] = await Promise.all([
        requireBuildContext(organizationId),
        requireBuildMovementContext(organizationId),
      ])
      const { completedAt } = input
      // `startBuild` stamps the wall clock, not the completion date; kept so both paths agree.
      const startedAt = new Date()

      const written = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const raised = await raiseBuildValues(txDb, organizationId, ctx, {
          partId: input.partId,
          quantityPlanned: input.quantity,
          source: input.source,
          period: input.period,
          batchRun: input.batchRun,
          notes: input.notes,
        })
        const priced = await priceCompletion(txDb, organizationId, {
          partId: input.partId,
          quantityProduced: input.quantity,
          quantityScrapped: 0,
        })

        const session = buildCompletionSession()
        const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, {
          session,
          bypassFieldGuards: BUILD_STATUS_BYPASS,
        })
        const values: Record<string, unknown> = {
          ...raised,
          ...completionBuildValues(priced, {
            quantityProduced: input.quantity,
            quantityScrapped: 0,
            completedAt,
          }),
        }
        if (ctx.fields.build_started_at) values.build_started_at = startedAt.toISOString()
        const created = await crud.create(ctx.defId, values)
        const buildRecordId = toRecordId(ctx.defId, created.instance.id)

        const movements = await writeCompletionMovements(txDb, organizationId, userId, {
          movementCtx,
          session,
          priced,
          buildRecordId,
          quantityProduced: input.quantity,
          completedAt,
        })
        // The build's searchText folds its movement list, which did not exist at create time.
        await flushInstanceDerived(txDb, organizationId, created.instance.id, {
          stampUpdatedAt: true,
          refreshSearchText: true,
        })
        return postCompletion(tx, organizationId, userId, {
          buildId: created.instance.id,
          orderId: null,
          buildRecordId,
          priced,
          movements,
          quantityProduced: input.quantity,
          quantityScrapped: 0,
          completedAt,
        })
      })

      await finishCompletion(db, organizationId, { ctx, movementCtx, written, completedAt })
      return written.result
    },
    'Failed to record a completed build',
    { organizationId, partId: input.partId }
  )
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
export function publishBuildUpdate(
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
