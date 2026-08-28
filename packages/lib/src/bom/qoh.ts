// packages/lib/src/bom/qoh.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { nextKeyAfter } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { buildFieldValueRow } from '../field-values/field-value-mutations'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'

const logger = createScopedLogger('bom:qoh')

// ─── Batch QoH Recalculation ────────────────────────────────────

/**
 * Recalculate QoH for multiple parts in one pass.
 * - 1 grouped SUM query for all parts
 * - 1 batch reorder point read
 * - Parallel writes for QoH + stock_status
 * - 1 batched realtime publish
 */
export async function batchRecalculateQoH(
  organizationId: string,
  partInstanceIds: string[]
): Promise<void> {
  if (partInstanceIds.length === 0) return

  const unique = [...new Set(partInstanceIds)]
  const cache = getOrgCache()

  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'stock_movement_quantity',
      'stock_movement_part',
      'stock_movement_adjust_subparts',
      'part_quantity_on_hand',
      'part_reorder_point',
      'part_stock_status',
    ] as const)

  const qtyField = fields.stock_movement_quantity
  const partRelField = fields.stock_movement_part
  const flagField = fields.stock_movement_adjust_subparts
  const qohField = fields.part_quantity_on_hand
  const reorderPointField = fields.part_reorder_point
  const statusField = fields.part_stock_status

  if (!qtyField || !partRelField || !qohField) return

  // 1. Grouped SUM: one query for all parts
  //    Excludes movements where adjust_subparts=true
  const sumRows = await database
    .select({
      partId: sql<string>`fv_part."relatedEntityId"`,
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_part`,
      sql`${schema.FieldValue.entityId} = fv_part."entityId"
        AND fv_part."fieldId" = ${partRelField.id}
        AND fv_part."relatedEntityId" IN (${sql.join(
          unique.map((id) => sql`${id}`),
          sql`, `
        )})
        AND fv_part."organizationId" = ${organizationId}`
    )
    .leftJoin(
      sql`"FieldValue" fv_flag`,
      sql`${schema.FieldValue.entityId} = fv_flag."entityId"
        AND fv_flag."fieldId" = ${flagField?.id ?? ''}
        AND fv_flag."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, qtyField.id),
        eq(schema.FieldValue.organizationId, organizationId),
        sql`(fv_flag."valueBoolean" IS NULL OR fv_flag."valueBoolean" = false)`
      )
    )
    .groupBy(sql`fv_part."relatedEntityId"`)

  const qohByPart = new Map<string, number>()
  for (const row of sumRows) {
    qohByPart.set(row.partId, Number(row.total ?? 0))
  }
  // Parts with zero movements won't appear — default to 0
  for (const id of unique) {
    if (!qohByPart.has(id)) qohByPart.set(id, 0)
  }

  // 2. Batch read reorder points (1 query)
  const reorderPoints = new Map<string, number | null>()
  if (reorderPointField) {
    const rpRows = await database
      .select({
        entityId: schema.FieldValue.entityId,
        valueNumber: schema.FieldValue.valueNumber,
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, unique),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, reorderPointField.id)
        )
      )
    for (const row of rpRows) {
      reorderPoints.set(row.entityId, row.valueNumber != null ? Number(row.valueNumber) : null)
    }
  }

  // 3. Batch write QoH + stock_status (2 queries: 1 bulk delete + 1 bulk insert)
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const realtimeEntries: FieldValueUpdateEntry[] = []

  const insertRows: Array<typeof schema.FieldValue.$inferInsert> = []

  for (const partId of unique) {
    const qoh = qohByPart.get(partId) ?? 0
    const reorderPoint = reorderPoints.get(partId) ?? null
    const status = deriveStockStatus(qoh, reorderPoint)
    const recordId = toRecordId(partDefId, partId) as RecordId

    // QoH field value row (single-value field; positional sortKey).
    insertRows.push(
      buildFieldValueRow({
        organizationId,
        entityId: partId,
        entityDefinitionId: partDefId,
        fieldId: qohField.id,
        fieldType: toFieldType(qohField.type),
        value: { type: 'number', value: qoh },
        sortKey: nextKeyAfter(null),
      })
    )

    // Stock status field value row
    if (statusField) {
      insertRows.push(
        buildFieldValueRow({
          organizationId,
          entityId: partId,
          entityDefinitionId: partDefId,
          fieldId: statusField.id,
          fieldType: toFieldType(statusField.type),
          value: { type: 'option', optionId: status },
          sortKey: nextKeyAfter(null),
        })
      )
    }

    // Collect realtime entries
    realtimeEntries.push({
      key: buildFieldValueKey(recordId, qohField.id as FieldId),
      value: { type: 'number', value: qoh },
    })
    if (statusField) {
      realtimeEntries.push({
        key: buildFieldValueKey(recordId, statusField.id as FieldId),
        value: { type: 'option', optionId: status },
      })
    }
  }

  // 1 bulk DELETE + 1 bulk INSERT, atomically
  // (plans/field-values/delete-insert-replace.md Phase 0): a crash between
  // the statements must not wipe stock levels for the whole batch.
  // Cross-entity bulk replace, so no per-(entity, field) advisory lock —
  // the transaction alone closes the destroy window.
  const fieldIds = [qohField.id, ...(statusField ? [statusField.id] : [])]
  await database.transaction(async (tx) => {
    await tx
      .delete(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, unique),
          inArray(schema.FieldValue.fieldId, fieldIds),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      )

    if (insertRows.length > 0) {
      await tx.insert(schema.FieldValue).values(insertRows)
    }
  })

  // 4. One batched realtime publish
  if (realtimeEntries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), organizationId, realtimeEntries).catch((err) => {
      logger.error('Failed to publish batch QoH realtime update', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  logger.info('Batch QoH recalculation complete', {
    parts: unique.length,
    organizationId,
  })
}

/** Derive stock status from QoH and reorder point. */
function deriveStockStatus(qoh: number, reorderPoint: number | null): string {
  if (qoh <= 0) return 'out_of_stock'
  if (reorderPoint != null && qoh <= reorderPoint) return 'low_stock'
  return 'in_stock'
}
