// packages/lib/src/inventory/builds/record-completed-builds.ts

/**
 * `recordCompletedBuilds` - `recordCompletedBuild` for many builds in ONE transaction: every read
 * once per batch, each build priced in memory by the same functions, builds and legs written
 * in one batch each (one number range for the slice), and one settle and one `build:changed` pass
 * after the commit (plans/mrp/12-slice-batched-backflush.md §2). All or nothing: a refused build
 * refuses the batch.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { exportInventoryMovement } from '../../accounting/ledger/post/post-inventory-movement'
import { upsertWorkItems } from '../../accounting/work-items/write'
import { loadDirectSubparts } from '../bom/subpart-graph'
import type { AbsorptionRates, PartStandardCost } from '../costing/types'
import { type StockMovementTouched, settleStockMovements, writeStockMovements } from '../movements'
import { assertPartsExist, assertPlannedQuantity, composeRaiseValues } from './build-mutations'
import {
  planComponentLines,
  priceComponentPlan,
  readAbsorptionRates,
  readPartKinds,
  readPartNames,
  readStandardCostMap,
} from './build-queries'
import { publishBuildsChanged } from './build-realtime'
import { insertBuilds, type NewBuild } from './build-writes'
import {
  assertQuantities,
  completionBuildValues,
  completionMovementInputs,
  type PricedCompletion,
  pendingBuildWorkItem,
  postCompletion,
  priceFromPlan,
  type RecordCompletedBuildInput,
  type WrittenCompletion,
} from './complete-build'
import { guard } from './guard'
import type { CompleteBuildResult } from './types'

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
      // `startBuild` stamps the wall clock, not the completion date; kept so both paths agree.
      const startedAt = new Date()

      const written = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const reads = await readBatch(txDb, organizationId, inputs)
        const priced = inputs.map((input) => priceBuild(reads, input, startedAt))
        const builds = await insertBuilds(
          tx,
          organizationId,
          userId,
          priced.map((build) => build.values)
        )
        const buildIds = builds.map((build) => build.buildId)

        const legs = priced.map((build, index) =>
          completionMovementInputs(build.priced, {
            buildId: buildIds[index]!,
            quantityProduced: build.input.quantity,
            completedAt: build.input.completedAt,
          })
        )
        const movements = await writeStockMovements({ db: tx, organizationId, userId }, legs.flat())
        if (movements.isErr()) throw movements.error

        const completions: WrittenCompletion[] = []
        let offset = 0
        for (const [index, build] of priced.entries()) {
          const buildLegs = legs[index]!
          const records = movements.value.records.slice(offset, offset + buildLegs.length)
          offset += buildLegs.length
          completions.push(
            await postCompletion(tx, organizationId, userId, {
              build: builds[index]!,
              priced: build.priced,
              movements: {
                records,
                touched: {
                  partIds: [...new Set(records.map((record) => record.partInstanceId))],
                  purchaseOrderLineIds: [],
                  fulfillmentLineIds: [],
                  buildIds: [buildIds[index]!],
                },
              },
              quantityProduced: build.input.quantity,
              quantityScrapped: 0,
              completedAt: build.input.completedAt,
            })
          )
        }
        return { completions, touched: movements.value.touched }
      })

      await finishCompletions(db, organizationId, written)
      return written.completions.map((completion) => completion.result)
    },
    'Failed to record completed builds',
    { organizationId, builds: inputs.length }
  )
}

/** The batch's reads: parts exist, one BOM read per distinct part, then kinds, standards, names, rates. */
async function readBatch(
  txDb: Database,
  organizationId: string,
  inputs: readonly RecordCompletedBuildInput[]
): Promise<BatchReads> {
  const partIds = [...new Set(inputs.map((input) => input.partId))]
  await assertPartsExist(txDb, organizationId, partIds)
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
  reads: BatchReads,
  input: RecordCompletedBuildInput,
  startedAt: Date
): { input: RecordCompletedBuildInput; priced: PricedCompletion; values: NewBuild } {
  assertPlannedQuantity(input.quantity)
  const edges = reads.edges.get(input.partId) ?? []
  const raised = composeRaiseValues(
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
  const values: NewBuild = {
    ...raised,
    ...completionBuildValues(priced, {
      quantityProduced: input.quantity,
      quantityScrapped: 0,
      completedAt: input.completedAt,
    }),
    startedAt,
  }
  return { input, priced, values }
}

/** `finishCompletion` once for the batch: one settle, one park, one build announcement. */
async function finishCompletions(
  db: Database,
  organizationId: string,
  args: { completions: WrittenCompletion[]; touched: StockMovementTouched }
): Promise<void> {
  const { completions: written, touched } = args
  await settleStockMovements(organizationId, touched)
  for (const completion of written) await exportInventoryMovement(db, completion.post)
  const parked = written.flatMap((completion) => pendingBuildWorkItem(completion) ?? [])
  if (parked.length > 0) await upsertWorkItems(db, organizationId, parked)
  await publishBuildsChanged(
    organizationId,
    written.map((w) => w.build)
  )
  logger.info('Completed builds', {
    organizationId,
    builds: written.length,
    movements: written.reduce((sum, w) => sum + w.result.movementIds.length, 0),
    pending: parked.length,
  })
}
