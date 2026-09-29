// packages/lib/src/field-hooks/post/inventory-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import type { FieldTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:inventory')

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
  const kinds = await readKinds(
    organizationId,
    recordIds.map((recordId) => parseRecordId(recordId).entityInstanceId)
  )

  for (const recordId of recordIds) {
    const { entityInstanceId } = parseRecordId(recordId)
    // A service has no stock status (107-D10).
    if (kinds.get(entityInstanceId) === 'service') continue

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
      fieldType: toFieldType(statusField.type),
      value: { type: 'option', optionId: status },
    })

    publishFieldValueUpdates(realtimeService, organizationId, [
      {
        key: buildFieldValueKey(partRecordId, statusField.id as FieldId),
        value: { type: 'option', optionId: status },
      },
    ]).catch(() => {})
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────

/** `part_kind` per part. Imported lazily, as `part-kind-derivation.ts` does, to keep hook loading light. */
async function readKinds(organizationId: string, partIds: string[]): Promise<Map<string, string>> {
  const { readPartKinds } = await import('../../inventory/builds/build-queries')
  return readPartKinds(database, organizationId, partIds)
}

/**
 * Derive stock status from QoH and reorder point.
 */
function deriveStockStatus(qoh: number, reorderPoint: number | null): string {
  if (qoh <= 0) return 'out_of_stock'
  if (reorderPoint != null && qoh <= reorderPoint) return 'low_stock'
  return 'in_stock'
}
