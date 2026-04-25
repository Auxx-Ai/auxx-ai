// packages/lib/src/field-hooks/post/vendor-part-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { requireCachedEntityDefId } from '../../cache'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import type { FieldTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:vendor-part')

/**
 * When vendor_part_is_preferred changes to true, clear isPreferred on all
 * other vendor parts belonging to the same parent part.
 *
 * Guard: only fires when the new value is `true` — prevents infinite recursion
 * when clearing other vendor parts (which sets their value to `false`).
 */
export const clearOtherPreferred: FieldTriggerHandler = async (event) => {
  const { recordIds, organizationId } = event

  for (const recordId of recordIds) {
    const { entityInstanceId } = parseRecordId(recordId)

    // 1. Read the current isPreferred value — only proceed if it's true
    const preferredRow = await database
      .select({ valueBoolean: schema.FieldValue.valueBoolean })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'vendor_part_is_preferred')
        )
      )
      .limit(1)

    if (!preferredRow[0]?.valueBoolean) continue

    // 2. Resolve the parent partId for this vendor part
    const partRow = await database
      .select({ relatedEntityId: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'vendor_part_part')
        )
      )
      .limit(1)

    const parentPartId = partRow[0]?.relatedEntityId
    if (!parentPartId) {
      logger.warn('Could not resolve parent part for clearOtherPreferred', { entityInstanceId })
      continue
    }

    // 3. Find all vendor part instances for the same parent part
    const siblingRows = await database
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.FieldValue.relatedEntityId, parentPartId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'vendor_part_part'),
          ne(schema.FieldValue.entityId, entityInstanceId)
        )
      )

    const siblingIds = siblingRows.map((r) => r.entityId)
    if (siblingIds.length === 0) continue

    // 4. Clear isPreferred on siblings (direct DB update to avoid triggering recursion)
    const isPreferredField = await database
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.systemAttribute, 'vendor_part_is_preferred'),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .limit(1)

    const fieldId = isPreferredField[0]?.id
    if (!fieldId) continue

    await database
      .update(schema.FieldValue)
      .set({ valueBoolean: false })
      .where(
        and(
          inArray(schema.FieldValue.entityId, siblingIds),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, organizationId)
        )
      )

    // Publish cleared preferred status to all clients
    const vendorPartDefId = await requireCachedEntityDefId(organizationId, 'vendor_part')
    const entries = siblingIds.map((siblingId) => {
      const siblingRecordId = toRecordId(vendorPartDefId, siblingId) as RecordId
      return {
        key: buildFieldValueKey(siblingRecordId, fieldId as FieldId),
        value: { type: 'boolean' as const, value: false },
      }
    })
    publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})

    logger.info('Cleared preferred status on sibling vendor parts', {
      parentPartId,
      clearedCount: siblingIds.length,
      preferredInstanceId: entityInstanceId,
    })
  }
}
