// packages/lib/src/field-triggers/triggers/bom-cost-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { recalculateAffectedParts, recalculateAllPartCosts } from '../../bom/cost-calculator'
import type { EntityTriggerHandler, FieldTriggerHandler } from '../types'

const logger = createScopedLogger('field-triggers:bom-cost')

/**
 * Recalculate part costs when vendor_part_unit_price, vendor_part_is_preferred,
 * or subpart_quantity field values change.
 *
 * Receives all affected recordIds in a single batch, resolves parent partIds
 * in one query, then recalculates all affected parts together.
 */
const recalculatePartCost: FieldTriggerHandler = async (event) => {
  const { recordIds, organizationId, systemAttribute } = event
  const entityInstanceIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)

  // Batch resolve all parent partIds in a single query
  const relationshipAttr = systemAttribute.startsWith('vendor_part')
    ? 'vendor_part_part'
    : 'subpart_parent_part'

  const partIds = await batchResolvePartIds(entityInstanceIds, organizationId, relationshipAttr)

  if (partIds.length === 0) {
    logger.warn('Could not resolve any affected parts for cost recalculation', {
      recordCount: recordIds.length,
      systemAttribute,
    })
    return
  }

  logger.info('Recalculating part costs from field change', {
    systemAttribute,
    affectedParts: partIds.length,
    organizationId,
  })

  await recalculateAffectedParts(organizationId, partIds)
}

/**
 * Recalculate part cost when a vendor_part or subpart entity is created or deleted.
 * The event.values contains the field values at the time of creation/deletion.
 */
const recalculatePartCostOnEntityChange: EntityTriggerHandler = async (event) => {
  const { organizationId, entitySlug, entityInstanceId, action, values } = event

  // Extract the parent part ID from event values
  let parentPartId: string | undefined

  if (entitySlug === 'vendor-parts') {
    parentPartId = extractRelatedEntityId(values, 'vendor_part_part')
  } else if (entitySlug === 'subparts') {
    parentPartId = extractRelatedEntityId(values, 'subpart_parent_part')
  }

  // If not in event values, look it up from field values directly
  // (works for both created and deleted — field values persist after archive)
  if (!parentPartId) {
    const ids = await batchResolvePartIds(
      [entityInstanceId],
      organizationId,
      entitySlug === 'vendor-parts' ? 'vendor_part_part' : 'subpart_parent_part'
    )
    parentPartId = ids[0]
  }

  if (!parentPartId) {
    // For deletions, field values may be gone — fall back to full org recalculation
    if (action === 'deleted') {
      logger.info('Falling back to full org cost recalculation on entity deletion', {
        entitySlug,
        entityInstanceId,
      })
      await recalculateAllPartCosts(organizationId)
      return
    }
    logger.warn('Could not determine affected part for entity change', {
      entitySlug,
      entityInstanceId,
      action,
    })
    return
  }

  logger.info('Recalculating part cost from entity change', {
    entitySlug,
    action,
    partId: parentPartId,
    organizationId,
  })

  await recalculateAffectedParts(organizationId, [parentPartId])
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Batch resolve parent partIds for multiple entity instances in a single query.
 * Looks up the relationship field value (e.g., vendor_part_part) for all instances at once.
 */
async function batchResolvePartIds(
  entityInstanceIds: string[],
  organizationId: string,
  relationshipSystemAttribute: string
): Promise<string[]> {
  if (entityInstanceIds.length === 0) return []

  const rows = await database
    .select({
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .where(
      and(
        inArray(schema.FieldValue.entityId, entityInstanceIds),
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, relationshipSystemAttribute)
      )
    )

  const partIds = rows.map((r) => r.relatedEntityId).filter((id): id is string => id != null)

  // Deduplicate — multiple instances may point to the same part
  return [...new Set(partIds)]
}

/**
 * Extract a related entity ID from event values.
 * Handles both plain entity instance IDs (from create events)
 * and RecordId format "defId:instId" (from delete events using captureEventData).
 */
function extractRelatedEntityId(
  values: Record<string, unknown>,
  systemAttribute: string
): string | undefined {
  const value = values[systemAttribute]
  if (typeof value !== 'string') return undefined
  // RecordId format contains a colon — extract the entity instance ID
  return value.includes(':') ? parseRecordId(value as any).entityInstanceId : value
}

export { recalculatePartCost, recalculatePartCostOnEntityChange }
