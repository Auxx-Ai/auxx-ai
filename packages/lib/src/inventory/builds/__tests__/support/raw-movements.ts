// packages/lib/src/inventory/builds/__tests__/support/raw-movements.ts

// Bulk `StockMovement` rows inserted directly, uncosted, carrying only what the dated reads use.
// For read tests and timings, never for write-path claims.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { sql } from 'drizzle-orm'

const db = () => getTestDb() as unknown as Database

export interface RawMovement {
  partId: string
  quantity: number
  /** Omitted leaves `occurredAt` unset, so the read falls back to `createdAt`. */
  occurredAt?: Date
  createdAt?: Date
  adjustSubparts?: boolean
}

export async function insertRawMovements(
  organizationId: string,
  movements: RawMovement[]
): Promise<void> {
  const now = new Date()
  for (let start = 0; start < movements.length; start += 1000) {
    await db()
      .insert(schema.StockMovement)
      .values(
        movements.slice(start, start + 1000).map((m) => ({
          id: crypto.randomUUID(),
          organizationId,
          partId: m.partId,
          type: 'adjust' as const,
          consumptionClass: 'adjustment' as const,
          quantity: m.quantity,
          occurredAt: m.occurredAt ?? null,
          createdAt: m.createdAt ?? now,
          adjustSubparts: m.adjustSubparts ?? false,
        }))
      )
  }
  // Fresh bulk rows have no planner stats.
  await db().execute(sql`ANALYZE "StockMovement"`)
}
