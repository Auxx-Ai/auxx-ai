// packages/lib/src/inventory/movements/fact/live.ts

import type { Database, Transaction } from '@auxx/database'
import { getInstanceId, isRecordId } from '../../../resources/resource-id'
import { readSystemRecords, systemFields } from '../../../resources/system-records'
import type { StockMovementInput } from '../types'
import { type ConsumptionClass, classifyMovement } from './classify'
import { readMovementFactClasses } from './reads'
import { classifyFacts, MOVEMENT_FACT_PICK } from './rebuild'
import type { MovementFactInput } from './writes'

/** A link as a bare instance id, whether the caller passed one or a `RecordId`. */
function bareId(value: string | undefined): string | null {
  if (!value) return null
  return isRecordId(value) ? getInstanceId(value) : value
}

/** The class of each original a reversal points at: the mirror's row, else a replay of the ledger row. */
export async function readOriginalClasses(
  db: Database | Transaction,
  organizationId: string,
  originalIds: readonly string[]
): Promise<Map<string, ConsumptionClass>> {
  const ids = [...new Set(originalIds.map((id) => bareId(id) as string))]
  const classes = await readMovementFactClasses(db, organizationId, ids)
  const missing = ids.filter((id) => !classes.has(id))
  if (missing.length === 0) return classes
  const ctx = await systemFields(db, organizationId, 'stock_movement', MOVEMENT_FACT_PICK)
  if (!ctx) return classes
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: missing,
    includeArchived: true,
  })
  const rows = records.flatMap((record) => {
    const type = record.option('stock_movement_type')
    if (!type) return []
    const partId = record.related('stock_movement_part') ?? ''
    return [
      {
        id: record.id,
        partId,
        type,
        quantity: 0,
        occurredAt: null,
        createdAt: record.createdAt,
        reversesMovementId: record.related('stock_movement_reverses_movement'),
        parentMovementId: record.related('stock_movement_parent_movement'),
      },
    ]
  })
  for (const row of classifyFacts(rows)) classes.set(row.id, row.consumptionClass)
  return classes
}

/** The mirror row for one movement `writeStockMovements` just created. */
export function movementFactFromInput(
  movementId: string,
  createdAt: Date,
  input: StockMovementInput,
  originalClasses: ReadonlyMap<string, ConsumptionClass>
): MovementFactInput {
  const links = input.links ?? {}
  const reversesMovementId = bareId(links.reversesMovementId)
  const parentMovementId = bareId(links.parentMovementId)
  return {
    id: movementId,
    partId: input.partInstanceId,
    type: input.type,
    quantity: input.quantity,
    occurredAt: input.occurredAt,
    createdAt,
    consumptionClass: classifyMovement(input.type, {
      reversesClass: reversesMovementId ? originalClasses.get(reversesMovementId) : null,
      parentMovementId,
      isSalvage: !reversesMovementId,
    }),
    reversesMovementId,
    parentMovementId,
    buildId: bareId(links.buildId),
    fulfillmentLineId: bareId(links.fulfillmentLineId),
    purchaseOrderLineId: bareId(links.purchaseOrderLineId),
  }
}
