// packages/lib/src/inventory/movements/fact/live.ts

import type { Database, Transaction } from '@auxx/database'
import { type ConsumptionClass, classifyMovement } from '../classify'
import { readMovementsByIds } from '../reads'
import type { StockMovementInput } from '../types'
import { readMovementFactClasses } from './reads'
import { classifyFacts } from './rebuild'
import type { MovementFactInput } from './writes'

/** The class of each original a reversal points at: the mirror's row, else a replay of the ledger row. */
export async function readOriginalClasses(
  db: Database | Transaction,
  organizationId: string,
  originalIds: readonly string[]
): Promise<Map<string, ConsumptionClass>> {
  const ids = [...new Set(originalIds)]
  const classes = await readMovementFactClasses(db, organizationId, ids)
  const missing = ids.filter((id) => !classes.has(id))
  if (missing.length === 0) return classes
  const rows = await readMovementsByIds(db, organizationId, missing)
  const facts = classifyFacts(
    rows.map((row) => ({
      id: row.id,
      partId: row.partId,
      type: row.type,
      quantity: 0,
      occurredAt: null,
      createdAt: row.createdAt,
      reversesMovementId: row.reversesMovementId,
      parentMovementId: row.parentMovementId,
    }))
  )
  for (const row of facts) classes.set(row.id, row.consumptionClass)
  return classes
}

/** The mirror row for one movement `writeStockMovements` just created; links are bare ids. */
export function movementFactFromInput(
  movementId: string,
  createdAt: Date,
  input: StockMovementInput,
  originalClasses: ReadonlyMap<string, ConsumptionClass>
): MovementFactInput {
  const links = input.links ?? {}
  const reversesMovementId = links.reversesMovementId ?? null
  const parentMovementId = links.parentMovementId ?? null
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
    buildId: links.buildId ?? null,
    fulfillmentLineId: links.fulfillmentLineId ?? null,
    purchaseOrderLineId: links.purchaseOrderLineId ?? null,
  }
}
