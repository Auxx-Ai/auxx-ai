// packages/lib/src/field-triggers/triggers/inventory-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import type { EntityTriggerHandler, FieldTriggerHandler } from '../types'

const logger = createScopedLogger('field-triggers:inventory')

/**
 * Recalculate part_quantity_on_hand and part_stock_status when a stock movement
 * is created or deleted.
 *
 * 1. Resolve which part was affected from the stock_movement_part relationship
 * 2. SUM all movement quantities for that part via a single self-join SQL query
 * 3. Write part_quantity_on_hand and derive part_stock_status
 */
export const recalculatePartQoH: EntityTriggerHandler = async (event) => {
  const { organizationId, entityInstanceId, action, values } = event

  // Resolve the affected part ID
  let partInstanceId = extractRelatedEntityId(values, 'stock_movement_part')

  if (!partInstanceId) {
    // Look up from field values directly
    const partRow = await database
      .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'stock_movement_part')
        )
      )
      .limit(1)

    partInstanceId = partRow[0]?.relatedEntityId ?? undefined
  }

  if (!partInstanceId) {
    logger.warn('Could not resolve affected part for QoH recalculation', {
      entityInstanceId,
      action,
    })
    return
  }

  logger.info('Recalculating QoH for part', {
    partInstanceId,
    action,
    movementId: entityInstanceId,
  })

  await recalculateQoHForPart(organizationId, partInstanceId)
}

/**
 * Recalculate part_stock_status when part_reorder_point is updated.
 * QoH hasn't changed, but the status threshold has.
 */
export const recalculateStockStatus: FieldTriggerHandler = async (event) => {
  const { recordIds, organizationId } = event

  const cache = getOrgCache()
  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'part_quantity_on_hand',
      'part_reorder_point',
      'part_stock_status',
    ] as const)

  const qohField = fields.part_quantity_on_hand
  const reorderPointField = fields.part_reorder_point
  const statusField = fields.part_stock_status

  if (!qohField || !reorderPointField || !statusField) {
    logger.warn('Missing custom fields for stock status calculation')
    return
  }

  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const ctx = createFieldValueContext(organizationId)
  const realtimeService = getRealtimeService()

  for (const recordId of recordIds) {
    const { entityInstanceId } = parseRecordId(recordId)

    logger.info('Recalculating stock status after reorder point change', {
      partInstanceId: entityInstanceId,
    })

    const rows = await database
      .select({
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.fieldId, [qohField.id, reorderPointField.id])
        )
      )

    let qoh = 0
    let reorderPoint: number | null = null
    for (const row of rows) {
      if (row.fieldId === qohField.id) qoh = Number(row.valueNumber ?? 0)
      if (row.fieldId === reorderPointField.id) {
        reorderPoint = row.valueNumber != null ? Number(row.valueNumber) : null
      }
    }

    const status = deriveStockStatus(qoh, reorderPoint)
    const partRecordId = toRecordId(partDefId, entityInstanceId) as RecordId

    await setValueWithType(ctx, {
      recordId: partRecordId,
      fieldId: statusField.id,
      fieldType: statusField.type,
      value: { type: 'string', value: status },
    })

    publishFieldValueUpdates(realtimeService, organizationId, [
      {
        key: buildFieldValueKey(partRecordId, statusField.id as FieldId),
        value: { type: 'string' as const, value: status },
      },
    ]).catch(() => {})
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * Recalculate QoH for a specific part by summing all its stock movement quantities
 * in a single self-join query, then write QoH + stock status in parallel.
 */
async function recalculateQoHForPart(organizationId: string, partInstanceId: string) {
  const cache = getOrgCache()
  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'stock_movement_quantity',
      'stock_movement_part',
      'part_quantity_on_hand',
      'part_reorder_point',
      'part_stock_status',
    ] as const)

  const qtyField = fields.stock_movement_quantity
  const partRelField = fields.stock_movement_part
  const qohField = fields.part_quantity_on_hand
  const reorderPointField = fields.part_reorder_point
  const statusField = fields.part_stock_status

  if (!qtyField || !partRelField || !qohField) {
    logger.warn('Missing custom fields for QoH calculation', {
      qtyField: !!qtyField,
      partRelField: !!partRelField,
      qohField: !!qohField,
    })
    return
  }

  // Single self-join: SUM movement quantities where the movement's part = partInstanceId
  const [sumRow] = await database
    .select({
      total: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
    })
    .from(schema.FieldValue)
    .innerJoin(
      sql`"FieldValue" fv_part`,
      sql`${schema.FieldValue.entityId} = fv_part."entityId"
        AND fv_part."fieldId" = ${partRelField.id}
        AND fv_part."relatedEntityId" = ${partInstanceId}
        AND fv_part."organizationId" = ${organizationId}`
    )
    .where(
      and(
        eq(schema.FieldValue.fieldId, qtyField.id),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  const qoh = Number(sumRow?.total ?? 0)

  // Resolve part context once
  const [partDefId, reorderPoint] = await Promise.all([
    requireCachedEntityDefId(organizationId, 'part'),
    readReorderPoint(organizationId, partInstanceId, reorderPointField?.id),
  ])

  const recordId = toRecordId(partDefId, partInstanceId) as RecordId
  const ctx = createFieldValueContext(organizationId)
  const status = deriveStockStatus(qoh, reorderPoint)

  // Write QoH + stock status in parallel
  const writes: Promise<unknown>[] = [
    setValueWithType(ctx, {
      recordId,
      fieldId: qohField.id,
      fieldType: qohField.type,
      value: { type: 'number', value: qoh },
    }),
  ]

  if (statusField) {
    writes.push(
      setValueWithType(ctx, {
        recordId,
        fieldId: statusField.id,
        fieldType: statusField.type,
        value: { type: 'string', value: status },
      })
    )
  }

  await Promise.all(writes)

  // Publish all updates in one batched call
  const realtimeService = getRealtimeService()
  const entries = [
    {
      key: buildFieldValueKey(recordId, qohField.id as FieldId),
      value: { type: 'number' as const, value: qoh },
    },
  ]

  if (statusField) {
    entries.push({
      key: buildFieldValueKey(recordId, statusField.id as FieldId),
      value: { type: 'string' as const, value: status },
    })
  }

  publishFieldValueUpdates(realtimeService, organizationId, entries).catch(() => {})

  logger.info('QoH recalculated', { partInstanceId, qoh, status })
}

/**
 * Read the reorder point field value for a part. Returns null if not set.
 */
async function readReorderPoint(
  organizationId: string,
  partInstanceId: string,
  reorderPointFieldId: string | undefined
): Promise<number | null> {
  if (!reorderPointFieldId) return null

  const rpRow = await database
    .select({ valueNumber: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, partInstanceId),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, reorderPointFieldId)
      )
    )
    .limit(1)

  return rpRow[0]?.valueNumber != null ? Number(rpRow[0].valueNumber) : null
}

/**
 * Derive stock status from QoH and reorder point.
 */
function deriveStockStatus(qoh: number, reorderPoint: number | null): string {
  if (qoh <= 0) return 'out_of_stock'
  if (reorderPoint != null && qoh <= reorderPoint) return 'low_stock'
  return 'in_stock'
}

/**
 * Extract a related entity ID from event values.
 */
function extractRelatedEntityId(
  values: Record<string, unknown>,
  systemAttribute: string
): string | undefined {
  const value = values[systemAttribute]
  if (typeof value !== 'string') return undefined
  return value.includes(':') ? parseRecordId(value as any).entityInstanceId : value
}
