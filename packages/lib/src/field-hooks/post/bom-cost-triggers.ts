// packages/lib/src/field-hooks/post/bom-cost-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { recalculateAffectedParts, recalculateAllPartCosts } from '../../bom/cost-calculator'
import type { FieldTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:bom-cost')

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
 * Batch cost recalc for a group of vendor-part/subpart lifecycle events (B2 §9). Replaces
 * the per-record `recalculatePartCostOnEntityChange` when these triggers run as native
 * record-rule actions: resolves every parent part across the whole batch, deduped, in at
 * most ONE DB query (only for records whose parent wasn't threaded in `values`), then a
 * single `recalculateAffectedParts`. On a bulk import of N vendor parts this is 1 lookup +
 * 1 recalc instead of N × (lookup + recalc). `relationshipAttr` is fixed by the declaring
 * def (vendor-parts ⇒ `vendor_part_part`, subparts ⇒ `subpart_parent_part`).
 */
export async function recalculatePartCostForEntityBatch(params: {
  organizationId: string
  relationshipAttr: 'vendor_part_part' | 'subpart_parent_part'
  action?: 'created' | 'deleted'
  records: Array<{ entityInstanceId: string; values?: Record<string, unknown> }>
}): Promise<void> {
  const { organizationId, relationshipAttr, action, records } = params
  if (records.length === 0) return

  const partIds = new Set<string>()
  const missing: string[] = []
  for (const { entityInstanceId, values } of records) {
    const fromValues = values ? extractRelatedEntityId(values, relationshipAttr) : undefined
    if (fromValues) partIds.add(fromValues)
    else missing.push(entityInstanceId)
  }

  // Single lookup for the records whose parent wasn't threaded (deletes with no captured
  // values, or non-string relationship formats). Soft-archive keeps FieldValue rows, so
  // deletes still resolve here.
  if (missing.length > 0) {
    const resolved = await batchResolvePartIds(missing, organizationId, relationshipAttr)
    for (const id of resolved) partIds.add(id)
  }

  if (partIds.size === 0) {
    if (action === 'deleted') {
      logger.info('Falling back to full org cost recalculation on entity deletion', {
        relationshipAttr,
        recordCount: records.length,
      })
      await recalculateAllPartCosts(organizationId)
      return
    }
    logger.warn('Could not determine affected parts for entity cost recalc', {
      relationshipAttr,
      recordCount: records.length,
    })
    return
  }

  logger.info('Recalculating part costs from entity change (batch)', {
    relationshipAttr,
    action,
    affectedParts: partIds.size,
    organizationId,
  })
  await recalculateAffectedParts(organizationId, [...partIds])
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

export { recalculatePartCost }
