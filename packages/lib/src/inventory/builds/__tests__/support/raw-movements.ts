// packages/lib/src/inventory/builds/__tests__/support/raw-movements.ts

// Bulk `stock_movement` rows written straight to EntityInstance/FieldValue, carrying only the
// four fields the dated reads join. For read tests and timings, never for write-path claims.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { sql } from 'drizzle-orm'
import { getOrgCache } from '../../../../cache'

const db = () => getTestDb() as unknown as Database

export interface RawMovement {
  partId: string
  quantity: number
  /** Omitted leaves `occurred_at` unset, so the read falls back to `createdAt`. */
  occurredAt?: Date
  createdAt?: Date
  adjustSubparts?: boolean
}

export async function insertRawMovements(
  organizationId: string,
  movementDefId: string,
  movements: RawMovement[]
): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'stock_movement_quantity',
      'stock_movement_part',
      'stock_movement_occurred_at',
      'stock_movement_adjust_subparts',
    ] as const)
  const qty = fields.stock_movement_quantity
  const part = fields.stock_movement_part
  const occurred = fields.stock_movement_occurred_at
  const flag = fields.stock_movement_adjust_subparts
  if (!qty || !part || !occurred || !flag) throw new Error('fixture: movement fields not seeded')

  const now = new Date()
  for (let start = 0; start < movements.length; start += 1000) {
    const chunk = movements
      .slice(start, start + 1000)
      .map((m) => ({ ...m, id: crypto.randomUUID() }))
    await db()
      .insert(schema.EntityInstance)
      .values(
        chunk.map((m) => ({
          id: m.id,
          organizationId,
          entityDefinitionId: movementDefId,
          createdAt: m.createdAt ?? now,
          updatedAt: now,
        }))
      )
    const values = chunk.flatMap((m) => {
      const base = {
        organizationId,
        entityId: m.id,
        entityDefinitionId: movementDefId,
        updatedAt: now,
      }
      return [
        { ...base, fieldId: qty.id, valueNumber: m.quantity },
        { ...base, fieldId: part.id, relatedEntityId: m.partId },
        ...(m.occurredAt
          ? [{ ...base, fieldId: occurred.id, valueDate: m.occurredAt.toISOString() }]
          : []),
        ...(m.adjustSubparts ? [{ ...base, fieldId: flag.id, valueBoolean: true }] : []),
      ]
    })
    await db().insert(schema.FieldValue).values(values)
  }
  // Fresh bulk rows have no planner stats; without them the EAV joins go nested-loop.
  await db().execute(sql`ANALYZE "EntityInstance", "FieldValue"`)
}
