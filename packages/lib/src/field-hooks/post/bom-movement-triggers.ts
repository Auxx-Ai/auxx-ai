// packages/lib/src/field-hooks/post/bom-movement-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { nextKeyAfter } from '@auxx/utils/fractional-indexing'
import { batchRecalculateQoH } from '../../bom/qoh'
import { getDeductionTargets, loadSubpartGraph } from '../../bom/subpart-graph'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { buildFieldValueRow, setValueWithType } from '../../field-values/field-value-mutations'
import { type StoredFieldType, toFieldType } from '../../field-values/stored-field-type'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:bom-movement')

// ─── Main Trigger Handler ──────────────────────────────────────────────

/**
 * Explode a BOM-aware stock movement into child movements for each leaf subpart.
 *
 * When a stock movement is created with stock_movement_adjust_subparts=true:
 * 1. Loads the subpart graph via recursive CTE (1 query)
 * 2. Flattens to leaf targets in-memory (with cycle detection)
 * 3. Batch inserts child EntityInstance + FieldValue rows (2 queries)
 * 4. Batch recalculates QoH for all affected leaf parts
 */
export const explodeBomMovement: EntityTriggerHandler = async (event) => {
  const { organizationId, entityInstanceId, action, values, userId } = event

  // Only fire on creation, not deletion
  if (action !== 'created') return

  // Check the adjust_subparts flag from event values
  const adjustSubparts = values.stock_movement_adjust_subparts
  if (!adjustSubparts) return

  // If this movement has a parent, it's a child — skip (safety guard)
  if (values.stock_movement_parent_movement) return

  // Resolve the affected part
  const partInstanceId = unwrapRelationId(values.stock_movement_part)
  if (!partInstanceId) {
    logger.warn('Could not resolve part for BOM explosion', { entityInstanceId })
    return
  }

  // Read the quantity from event values
  const quantity = Number(values.stock_movement_quantity ?? 0)
  if (quantity === 0) return

  // Read the type from event values
  const type = values.stock_movement_type ?? 'adjust'

  // Load subpart graph for this part's subtree only (1 recursive CTE query)
  const subpartGraph = await loadSubpartGraph(organizationId, partInstanceId)

  // Check if this part has subparts at all
  if (!subpartGraph.has(partInstanceId)) {
    // No subparts — clear the flag so recalculatePartQoH includes this movement
    await clearAdjustSubpartsFlag(organizationId, entityInstanceId)
    return
  }

  // Flatten to descendant targets (in-memory). The root is excluded — the
  // user-submitted parent movement itself counts as the root's deduction.
  const targets = getDeductionTargets(partInstanceId, quantity, subpartGraph)

  if (targets.length === 0) {
    logger.warn('BOM explosion produced no descendant targets', { partInstanceId })
    // Parent movement is the root's deduction — clear flag and recalc root.
    await clearAdjustSubpartsFlag(organizationId, entityInstanceId)
    await batchRecalculateQoH(organizationId, [partInstanceId])
    return
  }

  logger.info('Exploding BOM movement to descendant parts', {
    parentPart: partInstanceId,
    parentQuantity: quantity,
    descendantCount: targets.length,
  })

  // Resolve IDs from cache (0 DB calls)
  const stockMovementDefId = await requireCachedEntityDefId(organizationId, 'stock_movement')
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const cache = getOrgCache()
  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'stock_movement_part',
      'stock_movement_type',
      'stock_movement_quantity',
      'stock_movement_adjust_subparts',
      'stock_movement_parent_movement',
      'stock_movement_reason',
      'stock_movement_reference',
    ] as const)

  const reason = values.stock_movement_reason as string | undefined
  const reference = values.stock_movement_reference as string | undefined
  const parentMovementRecordId = toRecordId(stockMovementDefId, entityInstanceId)

  // ── Batch INSERT: EntityInstance rows (1 query) ──
  const insertedInstances = await database
    .insert(schema.EntityInstance)
    .values(
      targets.map(() => ({
        entityDefinitionId: stockMovementDefId,
        organizationId,
        createdById: userId || null,
        updatedAt: new Date(),
      }))
    )
    .returning({ id: schema.EntityInstance.id })

  // ── Batch INSERT: FieldValue rows (1 query) ──
  const fieldValueRows: Array<typeof schema.FieldValue.$inferInsert> = []

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!
    const instanceId = insertedInstances[i]!.id

    // Define typed values for this child movement
    const typedValues: Array<{
      field: { id: string; type: StoredFieldType }
      value: TypedFieldValueInput
    }> = [
      {
        field: fields.stock_movement_part!,
        value: {
          type: 'relationship',
          recordId: toRecordId(partDefId, target.partInstanceId) as RecordId,
        },
      },
      {
        field: fields.stock_movement_quantity!,
        value: { type: 'number', value: target.quantity },
      },
      {
        field: fields.stock_movement_type!,
        value: { type: 'option', optionId: type as string },
      },
      {
        field: fields.stock_movement_adjust_subparts!,
        value: { type: 'boolean', value: false },
      },
      {
        field: fields.stock_movement_parent_movement!,
        value: { type: 'relationship', recordId: parentMovementRecordId as RecordId },
      },
    ]

    if (fields.stock_movement_reason && reason) {
      typedValues.push({
        field: fields.stock_movement_reason,
        value: { type: 'text', value: reason },
      })
    }

    if (fields.stock_movement_reference && reference) {
      typedValues.push({
        field: fields.stock_movement_reference,
        value: { type: 'text', value: reference },
      })
    }

    // Convert each typed value to a FieldValue insert row.
    // These are single-value fields (one row per (entityId, fieldId)),
    // so the sortKey is purely positional — always the canonical first key.
    for (const { field, value } of typedValues) {
      fieldValueRows.push(
        buildFieldValueRow({
          organizationId,
          entityId: instanceId,
          entityDefinitionId: stockMovementDefId,
          fieldId: field.id,
          fieldType: toFieldType(field.type),
          value,
          sortKey: nextKeyAfter(null),
        })
      )
    }
  }

  await database.insert(schema.FieldValue).values(fieldValueRows)

  // Now that descendant movements are in place, clear the flag on the parent
  // movement so it counts toward the root part's QoH directly.
  await clearAdjustSubpartsFlag(organizationId, entityInstanceId)

  // ── Batch recalculate QoH for the root part + all affected descendants ──
  await batchRecalculateQoH(organizationId, [
    partInstanceId,
    ...targets.map((t) => t.partInstanceId),
  ])

  logger.info('BOM explosion complete', {
    parentMovement: entityInstanceId,
    childMovementsCreated: targets.length,
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Clear the adjust_subparts flag on a movement (when part has no subparts).
 * This ensures recalculatePartQoH includes this movement in its SUM.
 */
async function clearAdjustSubpartsFlag(
  organizationId: string,
  entityInstanceId: string
): Promise<void> {
  const cache = getOrgCache()
  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_adjust_subparts'] as const)

  const flagField = fields.stock_movement_adjust_subparts
  if (!flagField) return

  const stockMovementDefId = await requireCachedEntityDefId(organizationId, 'stock_movement')
  const recordId = toRecordId(stockMovementDefId, entityInstanceId) as RecordId
  const ctx = createFieldValueContext(organizationId)

  await setValueWithType(ctx, {
    recordId,
    fieldId: flagField.id,
    fieldType: toFieldType(flagField.type),
    value: { type: 'boolean', value: false },
  })
}
