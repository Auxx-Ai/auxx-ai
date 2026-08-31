// packages/lib/src/field-hooks/pre/guarded-movements.ts

import { database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getCachedEntityDefId, getOrgCache } from '../../cache'

/** One movement, reduced to the two facts a delete guard decides on. */
export interface GuardedMovement {
  id: string
  accountingDate: Date
}

/**
 * The `stock_movement` relations a delete guard can hang off.
 *
 * `stock_movement_purchase_order_line` points at the LINE, never at the order —
 * which is why the purchase-order guard is a two-hop read and the other two are
 * not.
 */
export type MovementRelationAttribute =
  | 'stock_movement_part'
  | 'stock_movement_build'
  | 'stock_movement_purchase_order_line'

/**
 * Every live stock movement whose `relationAttribute` names one of
 * `targetInstanceIds` (plans/money/tasks/21-money-parent-delete-safety.md §2).
 *
 * 🛑 **Not built on `listReceipts` / `getPartReceiptHistory`.** Both hard-filter
 * `stock_movement_type = 'receive'` (`receiving/receipt-queries.ts`), so a row
 * whose only history is a scrap, an `initial` opening balance or a build
 * consumption would pass a receipts-only check and delete clean out of a posted
 * month. A guard has to see every `StockMovementType`.
 *
 * ⚠️ **BOM explosion parents are deliberately INCLUDED**, which is where this
 * read differs from `gather-month-end-inventory.ts`. That module excludes them
 * because they carry no quantity and legitimately carry no cost, so counting
 * them would distort a total. Here they are ordinary ledger rows attached to the
 * record being deleted, and a settled month containing one is still settled.
 *
 * The accounting date is `stock_movement_occurred_at` **coalesced onto
 * `EntityInstance.createdAt`** — the documented fallback (`receipt-queries.ts`).
 * Deriving it any other way lets a movement be judged under one date and posted
 * under another.
 */
export async function readMovementsByRelation(
  organizationId: string,
  relationAttribute: MovementRelationAttribute,
  targetInstanceIds: readonly string[]
): Promise<GuardedMovement[]> {
  if (targetInstanceIds.length === 0) return []

  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!movementDefId) return []

  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([relationAttribute, 'stock_movement_occurred_at'])) as Record<
    string,
    { id: string } | null
  >

  // No relation field means no movement can name this parent, so there is
  // nothing to guard. An org mid-provisioning reaches this, not an error case.
  const relationField = fields[relationAttribute]
  if (!relationField) return []

  const relationValue = alias(schema.FieldValue, 'guard_mv_rel')
  const occurredValue = alias(schema.FieldValue, 'guard_mv_occurred')
  const occurredField = fields.stock_movement_occurred_at

  const query = database
    .select({
      id: schema.EntityInstance.id,
      occurredAt: occurredValue.valueDate,
      createdAt: schema.EntityInstance.createdAt,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      relationValue,
      and(
        eq(relationValue.entityId, schema.EntityInstance.id),
        eq(relationValue.organizationId, schema.EntityInstance.organizationId),
        eq(relationValue.fieldId, relationField.id),
        inArray(relationValue.relatedEntityId, [...targetInstanceIds])
      )
    )
    .$dynamic()

  const rows = await (occurredField
    ? query.leftJoin(
        occurredValue,
        and(
          eq(occurredValue.entityId, schema.EntityInstance.id),
          eq(occurredValue.organizationId, schema.EntityInstance.organizationId),
          eq(occurredValue.fieldId, occurredField.id)
        )
      )
    : query
  ).where(
    and(
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.entityDefinitionId, movementDefId),
      isNull(schema.EntityInstance.archivedAt)
    )
  )

  return rows.map((row) => ({
    id: row.id,
    accountingDate: row.occurredAt ? new Date(row.occurredAt) : row.createdAt,
  }))
}
