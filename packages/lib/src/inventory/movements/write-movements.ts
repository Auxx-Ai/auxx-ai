// packages/lib/src/inventory/movements/write-movements.ts

import { type CreateStockMovementInput, type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import type { Result } from 'neverthrow'
import { uniqueViolationConstraint } from '../../accounting/ledger/post/post-entry'
import { requireCachedEntityDefId } from '../../cache'
import { BadRequestError, ConflictError } from '../../errors'
import { recalculateFulfillmentLineQuantityRelievedBatch } from '../../field-hooks/post/fulfillment-line-rollups'
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollups,
} from '../../field-hooks/post/purchase-order-line-rollups'
import { chunkArray } from '../../import/utils/chunk-array'
import { getRealtimeService, publishRecordsChanged } from '../../realtime'
import { getDeductionTargets, loadSubpartGraph } from '../bom/subpart-graph'
import { readPartKinds } from '../builds/build-queries'
import { isServicePartKind } from '../costing/client'
import { batchRecalculateQoH } from '../costing/qoh'
import { movementFactFromInput, readOriginalClasses } from './fact/live'
import { insertMovementFacts, type MovementFactInput } from './fact/writes'
import { guard } from './guard'
import { toStockMovementRow } from './row'
import type {
  StockMovementInput,
  StockMovementsCtx,
  StockMovementTouched,
  WriteStockMovementsResult,
  WrittenStockMovement,
} from './types'

const logger = createScopedLogger('inventory-movements')

const INSERT_CHUNK = 500

/** The unique partial index that makes a second reversal of one movement impossible. */
const REVERSAL_UNIQUE_INDEX = 'StockMovement_reversesMovementId_key'

/**
 * Refuse any input whose part is a `service` (107-D10). A reversal is exempt: it
 * undoes a movement written while the part was still stocked.
 */
export async function assertNoServiceParts(
  ctx: StockMovementsCtx,
  inputs: readonly StockMovementInput[]
): Promise<void> {
  const partIds = inputs
    .filter((input) => !input.links?.reversesMovementId)
    .map((input) => input.partInstanceId)
  if (partIds.length === 0) return
  const kinds = await readPartKinds(ctx.db as unknown as Database, ctx.organizationId, partIds)
  const services = partIds.filter((partId) => isServicePartKind(kinds.get(partId)))
  if (services.length === 0) return
  throw new BadRequestError('A service holds no stock, so it cannot have a stock movement', {
    partIds: [...new Set(services)],
  })
}

/**
 * Write movements as one batched insert on `ctx.db` (pass the caller's transaction), plus their BOM
 * children and planning facts. Never opens a transaction and never recomputes QoH or roll-ups: the
 * caller MUST pass `touched` to {@link settleStockMovements} after its commit.
 */
export async function writeStockMovements(
  ctx: StockMovementsCtx,
  inputs: StockMovementInput[]
): Promise<Result<WriteStockMovementsResult, Error>> {
  return guard(
    async () => {
      if (inputs.length === 0) return { records: [], touched: emptyTouched() }
      await assertNoServiceParts(ctx, inputs)

      const createdAt = new Date()
      const meta = (id: string) => ({
        id,
        organizationId: ctx.organizationId,
        userId: ctx.userId || null,
        createdAt,
      })
      const rows = inputs.map((input) => toStockMovementRow(meta(generateId()), input))
      const children = await explodeBomRows(ctx, inputs, rows)

      // Parents before children, so a chunk never holds a child whose parent is still unwritten.
      for (const chunk of chunkArray([...rows, ...children], INSERT_CHUNK)) {
        await ctx.db
          .insert(schema.StockMovement)
          .values(chunk)
          .catch((error: unknown) => {
            if (uniqueViolationConstraint(error) === REVERSAL_UNIQUE_INDEX) {
              throw new ConflictError('This movement has already been reversed')
            }
            throw error
          })
      }

      const reversed = inputs.flatMap((input) => input.links?.reversesMovementId ?? [])
      const originalClasses = reversed.length
        ? await readOriginalClasses(ctx.db, ctx.organizationId, reversed)
        : new Map()
      await insertMovementFacts(ctx.db, ctx.organizationId, [
        ...inputs.map((input, i) =>
          movementFactFromInput(rows[i]!.id!, createdAt, input, originalClasses)
        ),
        ...children.map(childFact),
      ])

      const records: WrittenStockMovement[] = rows.map((row, i) => ({
        id: row.id!,
        partInstanceId: row.partId,
        quantity: row.quantity,
        unitCost: inputs[i]!.unitCost,
        extendedCost: row.extendedCostMinor ?? null,
        glRole: row.glRole ?? null,
        occurredAt: inputs[i]!.occurredAt,
      }))
      return { records, touched: touchedBy([...rows, ...children]) }
    },
    'Failed to write stock movements',
    { organizationId: ctx.organizationId, count: inputs.length }
  )
}

/** Child rows for every input that asked for a BOM explosion (inventory guide §8.2); uncosted, as before. */
async function explodeBomRows(
  ctx: StockMovementsCtx,
  inputs: readonly StockMovementInput[],
  rows: readonly CreateStockMovementInput[]
): Promise<CreateStockMovementInput[]> {
  const children: CreateStockMovementInput[] = []
  for (const [i, input] of inputs.entries()) {
    if (!input.adjustSubparts || input.links?.parentMovementId) continue
    const parent = rows[i]!
    const graph = await loadSubpartGraph(ctx.organizationId, input.partInstanceId)
    if (!graph.has(input.partInstanceId)) continue
    for (const target of getDeductionTargets(input.partInstanceId, input.quantity, graph)) {
      if (target.quantity === 0) continue
      children.push({
        id: generateId(),
        organizationId: parent.organizationId,
        createdById: parent.createdById,
        createdAt: parent.createdAt,
        partId: target.partInstanceId,
        type: parent.type,
        quantity: target.quantity,
        reason: parent.reason,
        reference: parent.reference,
        occurredAt: parent.occurredAt,
        parentMovementId: parent.id,
      })
    }
  }
  return children
}

/** A BOM child's planning fact: an exploded adjustment is always `adjustment`. */
function childFact(row: CreateStockMovementInput): MovementFactInput {
  return {
    id: row.id!,
    partId: row.partId,
    type: row.type,
    quantity: row.quantity,
    occurredAt: row.occurredAt ?? null,
    createdAt: row.createdAt!,
    consumptionClass: 'adjustment',
    parentMovementId: row.parentMovementId ?? null,
  }
}

function emptyTouched(): StockMovementTouched {
  return { partIds: [], purchaseOrderLineIds: [], fulfillmentLineIds: [], buildIds: [] }
}

/** The distinct parts and parent documents a set of rows points at. */
export function touchedBy(
  rows: ReadonlyArray<
    Pick<
      CreateStockMovementInput,
      'partId' | 'purchaseOrderLineId' | 'fulfillmentLineId' | 'buildId'
    >
  >
): StockMovementTouched {
  const distinct = (values: Array<string | null | undefined>) => [
    ...new Set(values.filter((v): v is string => !!v)),
  ]
  return {
    partIds: distinct(rows.map((row) => row.partId)),
    purchaseOrderLineIds: distinct(rows.map((row) => row.purchaseOrderLineId)),
    fulfillmentLineIds: distinct(rows.map((row) => row.fulfillmentLineId)),
    buildIds: distinct(rows.map((row) => row.buildId)),
  }
}

/**
 * After the commit: re-derive QoH, the PO-line received and FL relieved roll-ups, and tell open
 * part views their movement list changed. Never throws; the movements are already committed.
 */
export async function settleStockMovements(
  organizationId: string,
  touched: StockMovementTouched
): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['quantity on hand', () => batchRecalculateQoH(organizationId, touched.partIds)],
    [
      'purchase order line received',
      () =>
        recalculatePurchaseOrderLineRollups(
          organizationId,
          touched.purchaseOrderLineIds,
          PURCHASE_ORDER_LINE_ROLLUPS.received
        ),
    ],
    [
      'fulfillment line relieved',
      () =>
        recalculateFulfillmentLineQuantityRelievedBatch(organizationId, touched.fulfillmentLineIds),
    ],
    ['realtime', () => announceMovementParts(organizationId, touched.partIds)],
  ]
  for (const [step, run] of steps) {
    try {
      await run()
    } catch (error) {
      logger.error('Stock movement settle step failed', {
        organizationId,
        step,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/** `records:changed` on the part def: a part's inventory tab refetches its movement list. */
async function announceMovementParts(organizationId: string, partIds: string[]): Promise<void> {
  if (partIds.length === 0) return
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  await publishRecordsChanged(getRealtimeService(), organizationId, {
    entityDefinitionId: partDefId,
    entries: partIds.map((recordId) => ({ recordId })),
  })
}
