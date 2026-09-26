// packages/lib/src/inventory/builds/record-completed-builds.ts

/**
 * `recordCompletedBuilds` - `recordCompletedBuild` for many builds in ONE transaction: every read
 * once per batch, each build priced in memory by the same functions, builds and legs written
 * through the batched create, and one recalculation and one frame per def after the commit
 * (plans/mrp/12-slice-batched-backflush.md §2). All or nothing: a refused build refuses the batch.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { exportInventoryMovement } from '../../accounting/ledger/post/post-inventory-movement'
import { upsertWorkItems } from '../../accounting/work-items/write'
import { flushInstancesDerived } from '../../field-values/instance-derived'
import { createEntitiesBatch } from '../../resources/crud/create-entities-batch'
import { toRecordId } from '../../resources/resource-id'
import { loadDirectSubparts } from '../bom/subpart-graph'
import type { AbsorptionRates, PartStandardCost } from '../costing/types'
import { writeStockMovementsBatch } from '../movements'
import {
  assertPartsExist,
  assertPlannedQuantity,
  BUILD_STATUS_BYPASS,
  composeRaiseValues,
  requireDefId,
} from './build-mutations'
import {
  type BuildContext,
  type BuildMovementContext,
  planComponentLines,
  priceComponentPlan,
  readAbsorptionRates,
  readPartKinds,
  readPartNames,
  readStandardCostMap,
  requireBuildContext,
  requireBuildMovementContext,
} from './build-queries'
import {
  assertQuantities,
  completionBuildValues,
  completionMovementInputs,
  type PricedCompletion,
  pendingBuildWorkItem,
  postCompletion,
  priceFromPlan,
  type RecordCompletedBuildInput,
  recalculateAfterCommit,
  type WrittenCompletion,
} from './complete-build'
import { guard } from './guard'
import type { CompleteBuildResult } from './types'
import { buildCompletionSession, publishQuietBuildWrites } from './write-lane'

const logger = createScopedLogger('builds:record-completed')

/** Everything the builds of one batch read, loaded once. */
interface BatchReads {
  edges: Map<string, Array<{ childId: string; qty: number }>>
  standards: ReadonlyMap<string, PartStandardCost>
  kinds: ReadonlyMap<string, string>
  names: ReadonlyMap<string, string>
  rates: ReadonlyMap<string, AbsorptionRates>
}

/**
 * Raise, start and complete every build in one transaction, storing what one
 * `recordCompletedBuild` per input stores, in input order.
 */
export async function recordCompletedBuilds(
  db: Database,
  organizationId: string,
  userId: string,
  inputs: RecordCompletedBuildInput[]
): Promise<Result<CompleteBuildResult[], Error>> {
  return guard(
    async () => {
      if (inputs.length === 0) return []
      for (const input of inputs) assertQuantities(input.quantity, 0)
      const [ctx, movementCtx, partDefId] = await Promise.all([
        requireBuildContext(organizationId),
        requireBuildMovementContext(organizationId),
        requireDefId(organizationId, 'part'),
      ])
      // `startBuild` stamps the wall clock, not the completion date; kept so both paths agree.
      const startedAt = new Date()

      const written = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const reads = await readBatch(txDb, organizationId, partDefId, inputs)
        const priced = inputs.map((input) => priceBuild(ctx, partDefId, reads, input, startedAt))

        const session = buildCompletionSession()
        const builds = await createEntitiesBatch(
          { db: txDb, organizationId, userId, session, bypassFieldGuards: BUILD_STATUS_BYPASS },
          ctx.defId,
          priced.map((build) => build.values)
        )
        if (builds.isErr()) throw builds.error
        const buildIds = builds.value.map((build) => build.id)

        const legs = priced.map((build, index) =>
          completionMovementInputs(build.priced, {
            buildRecordId: toRecordId(ctx.defId, buildIds[index]!),
            quantityProduced: build.input.quantity,
            completedAt: build.input.completedAt,
          })
        )
        const movements = await writeStockMovementsBatch(
          {
            db: txDb,
            organizationId,
            userId,
            movementDefId: movementCtx.defId,
            partDefId: movementCtx.partDefId,
            lane: { kind: 'quiet', session, bypassFieldGuards: BUILD_STATUS_BYPASS },
          },
          legs.flat()
        )
        if (movements.isErr()) throw movements.error
        // The builds' searchText folds their movement lists, which did not exist at create time.
        await flushInstancesDerived(txDb, organizationId, buildIds, {
          stampUpdatedAt: true,
          refreshSearchText: true,
        })

        const completions: WrittenCompletion[] = []
        let offset = 0
        for (const [index, build] of priced.entries()) {
          const records = movements.value.records.slice(offset, offset + legs[index]!.length)
          offset += legs[index]!.length
          completions.push(
            await postCompletion(tx, organizationId, userId, {
              buildId: buildIds[index]!,
              orderId: null,
              buildRecordId: toRecordId(ctx.defId, buildIds[index]!),
              priced: build.priced,
              movements: {
                records,
                affectedPartIds: [...new Set(records.map((record) => record.partInstanceId))],
              },
              quantityProduced: build.input.quantity,
              quantityScrapped: 0,
              completedAt: build.input.completedAt,
            })
          )
        }
        return completions
      })

      await finishCompletions(db, organizationId, { ctx, movementCtx, written })
      return written.map((completion) => completion.result)
    },
    'Failed to record completed builds',
    { organizationId, builds: inputs.length }
  )
}

/** The batch's reads: parts exist, one BOM read per distinct part, then kinds, standards, names, rates. */
async function readBatch(
  txDb: Database,
  organizationId: string,
  partDefId: string,
  inputs: readonly RecordCompletedBuildInput[]
): Promise<BatchReads> {
  const partIds = [...new Set(inputs.map((input) => input.partId))]
  await assertPartsExist(txDb, organizationId, partDefId, partIds)
  // Per part, the query `planBuildComponents` runs, so every plan sees its BOM in the same order.
  const edges = new Map<string, Array<{ childId: string; qty: number }>>()
  for (const partId of partIds) {
    edges.set(partId, await loadDirectSubparts(txDb, organizationId, partId))
  }
  const componentIds = [...new Set([...edges.values()].flat().map((edge) => edge.childId))]
  const [kinds, standards, names, rates] = await Promise.all([
    readPartKinds(txDb, organizationId, [...partIds, ...componentIds]),
    readStandardCostMap(txDb, organizationId, [...partIds, ...componentIds]),
    readPartNames(txDb, organizationId, componentIds),
    readAbsorptionRates(txDb, organizationId, partIds),
  ])
  return { edges, standards, kinds, names, rates }
}

/** One build's create values and pricing, from the batch's reads, as `recordCompletedBuild` derives them. */
function priceBuild(
  ctx: BuildContext,
  partDefId: string,
  reads: BatchReads,
  input: RecordCompletedBuildInput,
  startedAt: Date
): { input: RecordCompletedBuildInput; priced: PricedCompletion; values: Record<string, unknown> } {
  assertPlannedQuantity(input.quantity)
  const edges = reads.edges.get(input.partId) ?? []
  const raised = composeRaiseValues(
    ctx,
    partDefId,
    {
      partId: input.partId,
      quantityPlanned: input.quantity,
      source: input.source,
      period: input.period,
      batchRun: input.batchRun,
      notes: input.notes,
    },
    { kind: reads.kinds.get(input.partId), subpartCount: edges.length }
  )
  const planInput = { partId: input.partId, quantityProduced: input.quantity, quantityScrapped: 0 }
  const plan = priceComponentPlan(planInput, planComponentLines(planInput, edges), reads)
  const priced = priceFromPlan(
    plan,
    reads.rates.get(input.partId) ?? { laborCostPerUnit: null, overheadCostPerUnit: null },
    reads.kinds.get(input.partId) ?? null,
    { quantityProduced: input.quantity, quantityScrapped: 0 }
  )
  const values: Record<string, unknown> = {
    ...raised,
    ...completionBuildValues(priced, {
      quantityProduced: input.quantity,
      quantityScrapped: 0,
      completedAt: input.completedAt,
    }),
  }
  if (ctx.fields.build_started_at) values.build_started_at = startedAt.toISOString()
  return { input, priced, values }
}

/** `finishCompletion` once for the batch: one recalculation, one park, one frame per def. */
async function finishCompletions(
  db: Database,
  organizationId: string,
  args: { ctx: BuildContext; movementCtx: BuildMovementContext; written: WrittenCompletion[] }
): Promise<void> {
  const { ctx, movementCtx, written } = args
  const partIds = [...new Set(written.flatMap((w) => w.result.recalculatedPartIds))]
  await recalculateAfterCommit(organizationId, partIds)
  for (const completion of written) await exportInventoryMovement(db, completion.post)
  const parked = written.flatMap((completion) => pendingBuildWorkItem(completion) ?? [])
  if (parked.length > 0) await upsertWorkItems(db, organizationId, parked)
  publishQuietBuildWrites(
    organizationId,
    movementCtx.defId,
    written.flatMap((w) => w.result.movementIds)
  )
  publishQuietBuildWrites(organizationId, movementCtx.partDefId, partIds)
  publishQuietBuildWrites(
    organizationId,
    ctx.defId,
    written.map((w) => w.result.buildId)
  )
  logger.info('Completed builds', {
    organizationId,
    builds: written.length,
    movements: written.reduce((sum, w) => sum + w.result.movementIds.length, 0),
    pending: parked.length,
  })
}
