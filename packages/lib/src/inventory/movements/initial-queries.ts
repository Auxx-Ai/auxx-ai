// packages/lib/src/inventory/movements/initial-queries.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { StockMovementType } from '../../resources/registry/enum-values'

/** A part's `initial` row as the anchor rules read it (111 Q26). */
export interface PartInitial {
  movementId: string
  partInstanceId: string
  quantity: number
  /** `effectiveAt`: `occurredAt`, or `createdAt` for a row written without one. */
  occurredAt: Date
  /** The count fact, absent on a row nothing has stamped yet. */
  countQuantity: number | null
  /** `YYYY-MM-DD`. */
  countDate: string | null
}

/** Each part's `initial` movement. A part with none is absent; a part with several (a raced double open) keeps its first. */
export async function readPartInitials(
  db: Database | Transaction,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, PartInitial>> {
  const initials = new Map<string, PartInitial>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return initials

  const t = schema.StockMovement
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        inArray(t.partId, unique),
        eq(t.type, StockMovementType.INITIAL)
      )
    )
    .orderBy(asc(t.effectiveAt), asc(t.createdAt), asc(t.id))
  for (const row of rows) {
    if (initials.has(row.partId)) continue
    initials.set(row.partId, {
      movementId: row.id,
      partInstanceId: row.partId,
      quantity: row.quantity,
      occurredAt: row.effectiveAt,
      countQuantity: row.countQuantity,
      countDate: row.countDate,
    })
  }
  return initials
}
