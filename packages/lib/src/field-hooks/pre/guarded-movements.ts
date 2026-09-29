// packages/lib/src/field-hooks/pre/guarded-movements.ts

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'

/** One movement, reduced to the two facts a delete guard decides on. */
export interface GuardedMovement {
  id: string
  accountingDate: Date
}

/** The `StockMovement` parent columns a delete guard can hang off. A PO names the line, never the order. */
export type MovementRelationColumn = 'partId' | 'buildId' | 'purchaseOrderLineId'

/**
 * Every stock movement whose `column` names one of `targetInstanceIds`
 * (plans/money/tasks/21-money-parent-delete-safety.md §2).
 *
 * Every type counts, BOM explosion parents included: a settled month containing one is still
 * settled. The accounting date is `effectiveAt`, the same date the movement posts under.
 */
export async function readMovementsByRelation(
  organizationId: string,
  column: MovementRelationColumn,
  targetInstanceIds: readonly string[]
): Promise<GuardedMovement[]> {
  if (targetInstanceIds.length === 0) return []
  const t = schema.StockMovement
  const rows = await database
    .select({ id: t.id, accountingDate: t.effectiveAt })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), inArray(t[column], [...targetInstanceIds])))
  return rows
}
