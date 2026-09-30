// packages/lib/src/inventory/builds/complete-build.ts

/**
 * `completeBuild`: consume the components and produce the good units at their frozen standard
 * costs, and post the build's entry. plans/products/build/01-build-plan.md section 3.4, README
 * B2/B4/B7/B8. The movements are written in the completion's transaction; QoH and the realtime
 * frames settle after the commit. No permission checks (`docs/lib-module-guide.md` section 6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import type { InventoryMovementLine } from '../../accounting/ledger/builders/inventory-movement'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  exportInventoryMovement,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import type { WorkItemRefusal } from '../../accounting/work-items/refusal'
import { upsertWorkItem, type WorkItemKey } from '../../accounting/work-items/write'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import {
  BuildStatus,
  StockMovementCostBasis,
  StockMovementType,
} from '../../resources/registry/enum-values'
import { isServicePartKind } from '../costing/client'
import { loadPartAbsorptionRates } from '../costing/standard-cost-queries'
import type { AbsorptionRates } from '../costing/types'
import {
  type StockMovementInput,
  type StockMovementTouched,
  settleStockMovements,
  type WriteStockMovementsResult,
  writeStockMovements,
} from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { raiseBuildValues } from './build-mutations'
import { assertBuildStatus, lockBuild, planBuildComponents, readPartKinds } from './build-queries'
import { publishBuildsChanged } from './build-realtime'
import { type BuildPatch, insertBuild, updateBuild } from './build-writes'
import {
  absorbedRunCost,
  type BuildCompletionSummary,
  canCompleteBuild,
  summarizeBuildCompletion,
  unitsStarted,
} from './client'
import { guard } from './guard'
import type {
  BuildComponentPlan,
  BuildRecord,
  CompleteBuildInput,
  CompleteBuildResult,
} from './types'

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

      const completedAt = input.completedAt ?? new Date()

      const written = await db.transaction(async (tx) =>
        writeCompletion(tx, organizationId, userId, {
          input,
          quantityProduced,
          quantityScrapped,
          completedAt,
        })
      )

      await finishCompletion(db, organizationId, written)
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
  written: WrittenCompletion
): Promise<void> {
  // After the commit, so QoH re-sums a ledger that holds the rows; also announces the parts.
  await settleStockMovements(organizationId, written.touched)
  await exportInventoryMovement(db, written.post)
  await parkPendingBuild(db, organizationId, written)
  await publishBuildsChanged(organizationId, [written.build])

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
  input: CompleteBuildInput
  quantityProduced: number
  quantityScrapped: number
  completedAt: Date
}

/** Everything the post-commit work needs, plus the caller's answer. */
export interface WrittenCompletion {
  result: CompleteBuildResult
  /** The build row as the transaction left it, for the `build:changed` frame. */
  build: BuildRecord
  /** The build's own inventory entry, awaiting its export. `null` on a pending build. */
  post: InTxPostResult | null
  /** The legs written `pending`, and the name of the first uncosted part, for the park. */
  pendingMovementIds: string[]
  pendingPartName: string | null
  /** For `settleStockMovements` after the commit. */
  touched: StockMovementTouched
}

/** Steps 2 and 3 plus the run's absorbed costs: everything the writes need, read on `tx`. */
export interface PricedCompletion {
  plan: BuildComponentPlan
  pendingPartIds: string[]
  summary: BuildCompletionSummary | null
  /** The produced part's inventory role, from its own `part_kind`. */
  produceGlRole: string
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
  const { input, quantityProduced, quantityScrapped, completedAt } = args
  const txDb = tx as unknown as Database

  // Step 1. The lock IS B8's enforcement - see `lockBuild`.
  const build = await lockBuild(tx, organizationId, input.buildId)
  assertBuildStatus(
    build,
    canCompleteBuild,
    'This build has already been completed or cancelled. A run finished in tranches is a second build.'
  )

  const priced = await priceCompletion(txDb, organizationId, {
    partId: build.partId,
    quantityProduced,
    quantityScrapped,
    componentOverrides: input.componentOverrides,
    laborCost: input.laborCost,
    overheadCost: input.overheadCost,
  })

  const movements = await writeCompletionMovements(tx, organizationId, userId, {
    priced,
    buildId: build.buildId,
    quantityProduced,
    completedAt,
  })

  // Step 6. On a pending build only labour and overhead are stamped; `price-build.ts` stamps the rest.
  const patch = completionBuildValues(priced, { quantityProduced, quantityScrapped, completedAt })
  if (input.notes) patch.notes = build.notes ? `${build.notes}\n${input.notes}` : input.notes
  const completed = await updateBuild(tx, organizationId, build.buildId, patch)

  return postCompletion(tx, organizationId, userId, {
    build: completed,
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
  // The rates the standard was rolled from, on the same snapshot, or the variance stops closing.
  const rates = await loadPartAbsorptionRates(txDb, organizationId, partId)
  const producedKinds = await readPartKinds(txDb, organizationId, [partId])
  return priceFromPlan(plan, rates, producedKinds.get(partId) ?? null, args)
}

/** Steps 2 and 3 from what they read; the batched completion prices every build with it. */
export function priceFromPlan(
  plan: BuildComponentPlan,
  rates: AbsorptionRates,
  producedKind: string | null,
  args: {
    quantityProduced: number
    quantityScrapped: number
    laborCost?: number
    overheadCost?: number
  }
): PricedCompletion {
  const { quantityProduced, quantityScrapped } = args
  assertPlanIsPostable(plan)
  // 111 Q18: any leg without a standard makes the WHOLE build pending. Its entry
  // is one document claimed once by the build id, so a partial entry now would
  // collide with the priced one later (73-D11).
  const pendingPartIds = plan.missingStandardPartIds
  const producedUnitCost = plan.producedUnitCost

  // The function the completion form previews with (`client.ts`). A pending build has no summary:
  // the pricer stamps it when the last leg is priced.
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

  if (isServicePartKind(producedKind ?? undefined)) {
    throw new BadRequestError('A service is not stocked, so it cannot be built')
  }

  const started = unitsStarted(quantityProduced, quantityScrapped)
  return {
    plan,
    pendingPartIds,
    summary,
    // From the produced part's OWN `part_kind`, not hard-coded to 1330: a subassembly
    // stamped 1330 would put raw-materials stock into Finished Goods.
    produceGlRole: resolveInventoryRoleForPartKind(producedKind),
    laborCost: absorbedRunCost(args.laborCost, rates.laborCostPerUnit, started),
    overheadCost: absorbedRunCost(args.overheadCost, rates.overheadCostPerUnit, started),
  }
}

/**
 * Steps 4 and 5 in one batched write: one `build_consume` per component at the NEGATED
 * quantity, then the single `build_produce`. `CompleteBuildResult.movementIds` keeps that order.
 */
async function writeCompletionMovements(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: {
    priced: PricedCompletion
    buildId: string
    quantityProduced: number
    completedAt: Date
  }
): Promise<WriteStockMovementsResult> {
  const written = await writeStockMovements(
    { db: tx, organizationId, userId },
    completionMovementInputs(args.priced, args)
  )
  if (written.isErr()) throw written.error
  return written.value
}

/** A completion's legs, consumes in plan order then the produce. */
export function completionMovementInputs(
  priced: PricedCompletion,
  args: { buildId: string; quantityProduced: number; completedAt: Date }
): StockMovementInput[] {
  const { buildId, completedAt } = args
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
    glRole: line.glRole,
    costBasis:
      line.unitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
    occurredAt: completedAt,
    // NULL is the OFF-BOM marker, written as an absence: a stamped 0 would claim the BOM
    // calls for none of this component.
    qtyPerUnit: line.qtyPerUnit,
    links: { buildId },
  }))
  const produceUnitCost = priced.plan.producedUnitCost
  const produceInput: StockMovementInput = {
    partInstanceId: priced.plan.partId,
    type: StockMovementType.BUILD_PRODUCE,
    // `quantityProduced`, never `unitsStarted` (B7): scrap's cost falls out in `varianceAmount`.
    quantity: args.quantityProduced,
    unitCost: produceUnitCost,
    extendedCost: priced.summary?.producedValue,
    glRole: priced.produceGlRole,
    costBasis:
      produceUnitCost == null ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
    occurredAt: completedAt,
    links: { buildId },
  }
  return [...consumeInputs, produceInput]
}

/** The status and cost fields a completion stamps on its build. */
export function completionBuildValues(
  priced: PricedCompletion,
  run: { quantityProduced: number; quantityScrapped: number; completedAt: Date }
): BuildPatch {
  return {
    status: BuildStatus.COMPLETED,
    quantityProduced: run.quantityProduced,
    quantityScrapped: run.quantityScrapped,
    completedAt: run.completedAt,
    laborCost: priced.laborCost,
    overheadCost: priced.overheadCost,
    materialCost: priced.summary?.materialCost ?? null,
    producedValue: priced.summary?.producedValue ?? null,
    varianceAmount: priced.summary?.varianceAmount ?? null,
  }
}

/**
 * The build's own entry, inside the completion's transaction: consumes and produces move between
 * the inventory accounts, absorbed labour and overhead come out of their pools, and the residual
 * is the run's variance. A pending build posts nothing; the pricer posts it once every leg is priced.
 */
export async function postCompletion(
  tx: Transaction,
  organizationId: string,
  userId: string,
  args: {
    build: BuildRecord
    priced: PricedCompletion
    movements: WriteStockMovementsResult
    quantityProduced: number
    quantityScrapped: number
    completedAt: Date
  }
): Promise<WrittenCompletion> {
  const { build, priced, movements, completedAt } = args
  const { buildId, orderId } = build
  const { summary, pendingPartIds } = priced
  const movementLines: InventoryMovementLine[] = movements.records
    .filter((record) => record.glRole && record.extendedCost != null && record.extendedCost !== 0)
    .map((record) => ({
      id: record.id,
      extendedCostMinor: record.extendedCost as number,
      glAccountRole: record.glRole as string,
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
      .map((record) => record.id),
    pendingPartName:
      priced.plan.components.find((line) => line.partId === firstPendingPartId)?.partName ?? null,
    touched: movements.touched,
    build,
    result: {
      buildId,
      quantityProduced: args.quantityProduced,
      quantityScrapped: args.quantityScrapped,
      materialCost: summary?.materialCost ?? null,
      laborCost: priced.laborCost,
      overheadCost: priced.overheadCost,
      producedValue: summary?.producedValue ?? null,
      varianceAmount: summary?.varianceAmount ?? null,
      pendingPartIds,
      movementIds: movements.records.map((record) => record.id),
      recalculatedPartIds: movements.touched.partIds,
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
      const { completedAt } = input
      // `startBuild` stamps the wall clock, not the completion date; kept so both paths agree.
      const startedAt = new Date()

      const written = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const raised = await raiseBuildValues(txDb, organizationId, {
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
        const build = await insertBuild(tx, organizationId, userId, {
          ...raised,
          ...completionBuildValues(priced, {
            quantityProduced: input.quantity,
            quantityScrapped: 0,
            completedAt,
          }),
          startedAt,
        })
        const movements = await writeCompletionMovements(tx, organizationId, userId, {
          priced,
          buildId: build.buildId,
          quantityProduced: input.quantity,
          completedAt,
        })
        return postCompletion(tx, organizationId, userId, {
          build,
          priced,
          movements,
          quantityProduced: input.quantity,
          quantityScrapped: 0,
          completedAt,
        })
      })

      await finishCompletion(db, organizationId, written)
      return written.result
    },
    'Failed to record a completed build',
    { organizationId, partId: input.partId }
  )
}

/**
 * Refuse a plan that consumes nothing.
 *
 * A missing standard is no longer a refusal: `readStandardCost` omits a part with no usable
 * standard, and such a leg is written `pending` (111 Q18). A deliberate $0 standard (103 §5a) is
 * present and builds at $0.
 */
export function assertPlanIsPostable(plan: BuildComponentPlan): void {
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
  const item = pendingBuildWorkItem(written)
  if (item) await upsertWorkItem(db, organizationId, item)
}

/** The `price` work item a pending build parks under, or null for a priced build. */
export function pendingBuildWorkItem(
  written: WrittenCompletion
): (WorkItemKey & WorkItemRefusal) | null {
  const partId = written.result.pendingPartIds[0]
  if (!partId) return null
  return {
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
export function assertQuantities(quantityProduced: number, quantityScrapped: number): void {
  if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    throw new BadRequestError('A completed build must produce at least one unit')
  }
  if (!Number.isFinite(quantityScrapped) || quantityScrapped < 0) {
    throw new BadRequestError('Scrapped units cannot be negative')
  }
}
