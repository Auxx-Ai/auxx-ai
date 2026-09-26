// packages/lib/src/inventory/movements/claim-pending.ts

import { schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { StockMovementCostBasis } from '../../resources/registry/enum-values'

const CHUNK = 1000

/**
 * Row-lock the movements whose cost basis is still `pending`, inside the caller's transaction,
 * and return their ids. A concurrent pricer blocks here and then sees the row as no longer pending.
 */
export async function claimPendingMovements(
  tx: Transaction,
  organizationId: string,
  basisFieldId: string,
  movementIds: readonly string[]
): Promise<Set<string>> {
  const t = schema.FieldValue
  // Sorted so two passes lock overlapping rows in the same order and cannot deadlock.
  const ids = [...new Set(movementIds)].sort()
  const claimed = new Set<string>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await tx
      .select({ entityId: t.entityId })
      .from(t)
      .where(
        and(
          eq(t.organizationId, organizationId),
          eq(t.fieldId, basisFieldId),
          inArray(t.entityId, ids.slice(i, i + CHUNK)),
          eq(t.optionId, StockMovementCostBasis.PENDING)
        )
      )
      .orderBy(asc(t.entityId))
      .for('update')
    for (const row of rows) claimed.add(row.entityId)
  }
  return claimed
}
