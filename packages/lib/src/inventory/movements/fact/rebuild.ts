// packages/lib/src/inventory/movements/fact/rebuild.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import {
  readSystemRecords,
  type SystemRecord,
  systemFields,
} from '../../../resources/system-records'
import { guard } from '../guard'
import { type ConsumptionClass, classifyMovement } from './classify'
import {
  deleteOrganizationMovementFacts,
  insertMovementFacts,
  type MovementFactInput,
} from './writes'

/** Everything a mirror row is built from. */
export const MOVEMENT_FACT_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_occurred_at',
  'stock_movement_reverses_movement',
  'stock_movement_parent_movement',
  'stock_movement_build',
  'stock_movement_fulfillment_line',
  'stock_movement_purchase_order_line',
] as const)

type MovementFactAttribute = (typeof MOVEMENT_FACT_PICK)[number]

/** A mirror row before its class is known, since a reversal's class is its original's. */
type UnclassifiedFact = Omit<MovementFactInput, 'consumptionClass'>

function toUnclassified(record: SystemRecord<MovementFactAttribute>): UnclassifiedFact | null {
  const partId = record.related('stock_movement_part')
  const type = record.option('stock_movement_type')
  if (!partId || !type) return null
  const occurredAt = record.date('stock_movement_occurred_at')
  return {
    id: record.id,
    partId,
    type,
    quantity: record.number('stock_movement_quantity') ?? 0,
    occurredAt: occurredAt ? new Date(occurredAt) : null,
    createdAt: record.createdAt,
    reversesMovementId: record.related('stock_movement_reverses_movement'),
    parentMovementId: record.related('stock_movement_parent_movement'),
    buildId: record.related('stock_movement_build'),
    fulfillmentLineId: record.related('stock_movement_fulfillment_line'),
    purchaseOrderLineId: record.related('stock_movement_purchase_order_line'),
  }
}

/** Second pass: classify every row, a reversal through its original's class (chains walked, cycles cut). */
export function classifyFacts(rows: readonly UnclassifiedFact[]): MovementFactInput[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const classes = new Map<string, ConsumptionClass>()
  const resolve = (row: UnclassifiedFact, seen: Set<string>): ConsumptionClass => {
    const known = classes.get(row.id)
    if (known) return known
    seen.add(row.id)
    const original = row.reversesMovementId ? byId.get(row.reversesMovementId) : undefined
    const reversesClass = original && !seen.has(original.id) ? resolve(original, seen) : undefined
    const result = classifyMovement(row.type, {
      reversesClass,
      parentMovementId: row.parentMovementId,
      isSalvage: !row.reversesMovementId,
    })
    classes.set(row.id, result)
    return result
  }
  return rows.map((row) => ({ ...row, consumptionClass: resolve(row, new Set()) }))
}

/** Replace an org's mirror with a replay of every `stock_movement` instance, archived included, as QoH counts them. */
export async function rebuildMovementFacts(
  db: Database,
  organizationId: string
): Promise<Result<{ inserted: number }, Error>> {
  return guard(
    async () =>
      db.transaction(async (tx) => {
        await deleteOrganizationMovementFacts(tx, organizationId)
        const ctx = await systemFields(tx, organizationId, 'stock_movement', MOVEMENT_FACT_PICK, {
          required: ['stock_movement_part', 'stock_movement_type', 'stock_movement_quantity'],
        })
        if (!ctx) return { inserted: 0 }
        const records = await readSystemRecords(tx, organizationId, ctx, {
          includeArchived: true,
        })
        const unclassified = records
          .map(toUnclassified)
          .filter((row): row is UnclassifiedFact => row !== null)
        const inserted = await insertMovementFacts(tx, organizationId, classifyFacts(unclassified))
        return { inserted }
      }),
    'Failed to rebuild the movement mirror',
    { organizationId }
  )
}
