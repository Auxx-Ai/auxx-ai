// packages/lib/src/field-hooks/post/bom-cost-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { recalculateAffectedParts, recalculateAllPartCosts } from '../../bom/cost-calculator'
import { unwrapRelationId } from '../../resources/events/captured-values'
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
  await ensureFirstStandardCosts(organizationId, partIds)
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
    const fromValues = values ? unwrapRelationId(values[relationshipAttr]) : undefined
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
  const affected = [...partIds]
  await recalculateAffectedParts(organizationId, affected)
  await ensureFirstStandardCosts(organizationId, affected)
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Give a newly priced part, and its parents, a FIRST standard cost
 * (plans/money/tasks/15-costing-usability.md §2a).
 *
 * Runs immediately after `recalculateAffectedParts`, so `part_cost` is already
 * the refreshed replacement cost `ensureStandardCost` rolls from. It widens to
 * ancestors itself: pricing a component is what makes its parent rollable, and
 * without the widening the parent stays unvalued one level up.
 *
 * 🛑 **This can never restate an existing standard.** `ensureStandardCost`
 * writes exclusively where `part_standard_cost IS NULL`. A price change on a
 * part that already has a standard moves `part_cost` and leaves the standard
 * alone, which is the whole reason the two fields are separate: a standard that
 * drifted with vendor quotes would silently restate every closed period.
 *
 * 🛑 **It must never break the price save.** This is a post-commit hook on a
 * `vendor_part` or `subpart` write, and the price is the fact the user asked to
 * record. A failure here is logged and swallowed, including the setting read:
 * the worst case is a part that stays unrolled, which is the state it was in
 * before the price arrived.
 *
 * The two collaborators are imported lazily, the same way `settings-service`
 * reaches the org cache. Neither is on the path a field hook has to be able to
 * load: this is optional, best-effort work hanging off the end of a recalc, and
 * a static import would put the whole standard-cost and settings graph into
 * every module that so much as registers a trigger.
 */
async function ensureFirstStandardCosts(organizationId: string, partIds: string[]): Promise<void> {
  if (partIds.length === 0) return

  try {
    const [{ ensureStandardCost }, { getOrganizationSetting }] = await Promise.all([
      import('../../builds/ensure-standard-cost'),
      import('../../settings/settings-service'),
    ])

    const enabled = await getOrganizationSetting({
      organizationId,
      key: 'manufacturing.autoRollFirstStandard',
    })
    // Default is on, so only an explicit `false` turns it off. An org running a
    // strict standard-cost discipline sets it and keeps the manual roll.
    if (enabled === false) return

    const result = await ensureStandardCost(database, organizationId, partIds, {
      kind: 'supplier-price',
    })
    if (result.isErr()) {
      logger.warn('Could not set first standard costs after a price change', {
        organizationId,
        consideredParts: partIds.length,
        error: result.error,
      })
      return
    }
    if (result.value.writtenPartIds.length > 0) {
      logger.info('Set first standard costs after a price change', {
        organizationId,
        consideredParts: partIds.length,
        writtenParts: result.value.writtenPartIds.length,
      })
    }
  } catch (error) {
    logger.warn('First standard cost pass failed after a price change', {
      organizationId,
      consideredParts: partIds.length,
      error,
    })
  }
}

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

export { recalculatePartCost }
