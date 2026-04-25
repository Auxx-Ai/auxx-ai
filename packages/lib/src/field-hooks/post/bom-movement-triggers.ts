// packages/lib/src/field-hooks/post/bom-movement-triggers.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValueInput } from '@auxx/types'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { buildFieldValueRow, setValueWithType } from '../../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:bom-movement')

const MAX_BOM_DEPTH = 20

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
  const partInstanceId = extractRelatedEntityId(values, 'stock_movement_part')
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

  // Flatten to leaf targets (in-memory)
  const leafTargets = getDeductionTargets(partInstanceId, quantity, subpartGraph)

  if (leafTargets.length === 0) {
    logger.warn('BOM explosion produced no leaf targets', { partInstanceId })
    return
  }

  logger.info('Exploding BOM movement to leaf parts', {
    parentPart: partInstanceId,
    parentQuantity: quantity,
    leafCount: leafTargets.length,
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
      leafTargets.map(() => ({
        entityDefinitionId: stockMovementDefId,
        organizationId,
        createdById: userId || null,
        updatedAt: new Date(),
      }))
    )
    .returning({ id: schema.EntityInstance.id })

  // ── Batch INSERT: FieldValue rows (1 query) ──
  const fieldValueRows: Array<typeof schema.FieldValue.$inferInsert> = []

  for (let i = 0; i < leafTargets.length; i++) {
    const target = leafTargets[i]!
    const instanceId = insertedInstances[i]!.id

    // Define typed values for this child movement
    const typedValues: Array<{ fieldId: string; value: TypedFieldValueInput }> = [
      {
        fieldId: fields.stock_movement_part!.id,
        value: {
          type: 'relationship',
          recordId: toRecordId(partDefId, target.partInstanceId) as RecordId,
        },
      },
      {
        fieldId: fields.stock_movement_quantity!.id,
        value: { type: 'number', value: target.quantity },
      },
      {
        fieldId: fields.stock_movement_type!.id,
        value: { type: 'option', optionId: type as string },
      },
      {
        fieldId: fields.stock_movement_adjust_subparts!.id,
        value: { type: 'boolean', value: false },
      },
      {
        fieldId: fields.stock_movement_parent_movement!.id,
        value: { type: 'relationship', recordId: parentMovementRecordId as RecordId },
      },
    ]

    if (fields.stock_movement_reason && reason) {
      typedValues.push({
        fieldId: fields.stock_movement_reason.id,
        value: { type: 'text', value: reason },
      })
    }

    if (fields.stock_movement_reference && reference) {
      typedValues.push({
        fieldId: fields.stock_movement_reference.id,
        value: { type: 'text', value: reference },
      })
    }

    // Convert each typed value to a FieldValue insert row
    for (const { fieldId, value } of typedValues) {
      fieldValueRows.push(
        buildFieldValueRow({
          organizationId,
          entityId: instanceId,
          entityDefinitionId: stockMovementDefId,
          fieldId,
          value,
        })
      )
    }
  }

  await database.insert(schema.FieldValue).values(fieldValueRows)

  // ── Batch recalculate QoH for all affected leaf parts ──
  await batchRecalculateQoH(
    organizationId,
    leafTargets.map((t) => t.partInstanceId)
  )

  logger.info('BOM explosion complete', {
    parentMovement: entityInstanceId,
    childMovementsCreated: leafTargets.length,
  })
}

// ─── Subpart Graph Loader ──────────────────────────────────────────────

/**
 * Load the subpart graph for a specific part's subtree using a recursive CTE.
 * Returns only the parent→child edges reachable from rootPartId.
 *
 * The CTE has a depth limit (MAX_BOM_DEPTH) which:
 * 1. Scopes the query to only relevant relationships (not entire org)
 * 2. Prevents infinite recursion from circular BOM refs at the DB level
 * 3. Acts as a safety valve for unreasonably deep BOMs
 */
async function loadSubpartGraph(
  organizationId: string,
  rootPartId: string
): Promise<Map<string, { childId: string; qty: number }[]>> {
  const cache = getOrgCache()
  const subpartDefId = await requireCachedEntityDefId(organizationId, 'subpart')

  const cfFields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['subpart_parent_part', 'subpart_child_part', 'subpart_quantity'] as const)

  const spParentField = cfFields.subpart_parent_part
  const spChildField = cfFields.subpart_child_part
  const spQtyField = cfFields.subpart_quantity

  if (!spParentField || !spChildField || !spQtyField) return new Map()

  // Recursive CTE: walk from rootPartId down through the subpart graph.
  // Each row returned is a (parentId, childId, qty) edge in the subtree.
  const result = await database.execute(sql`
    WITH RECURSIVE subtree AS (
      -- Base case: direct children of the root part
      SELECT
        parent_fv."relatedEntityId" AS parent_id,
        child_fv."relatedEntityId" AS child_id,
        qty_fv."valueNumber" AS qty,
        1 AS depth
      FROM ${schema.EntityInstance} ei
      JOIN ${schema.FieldValue} parent_fv
        ON parent_fv."entityId" = ei.id
        AND parent_fv."fieldId" = ${spParentField.id}
        AND parent_fv."organizationId" = ${organizationId}
      JOIN ${schema.FieldValue} child_fv
        ON child_fv."entityId" = ei.id
        AND child_fv."fieldId" = ${spChildField.id}
        AND child_fv."organizationId" = ${organizationId}
      JOIN ${schema.FieldValue} qty_fv
        ON qty_fv."entityId" = ei.id
        AND qty_fv."fieldId" = ${spQtyField.id}
        AND qty_fv."organizationId" = ${organizationId}
      WHERE ei."organizationId" = ${organizationId}
        AND ei."entityDefinitionId" = ${subpartDefId}
        AND ei."archivedAt" IS NULL
        AND parent_fv."relatedEntityId" = ${rootPartId}

      UNION ALL

      -- Recursive step: follow each child to find its children
      SELECT
        parent_fv."relatedEntityId" AS parent_id,
        child_fv."relatedEntityId" AS child_id,
        qty_fv."valueNumber" AS qty,
        st.depth + 1 AS depth
      FROM subtree st
      JOIN ${schema.FieldValue} parent_fv
        ON parent_fv."relatedEntityId" = st.child_id
        AND parent_fv."fieldId" = ${spParentField.id}
        AND parent_fv."organizationId" = ${organizationId}
      JOIN ${schema.EntityInstance} ei
        ON ei.id = parent_fv."entityId"
        AND ei."organizationId" = ${organizationId}
        AND ei."entityDefinitionId" = ${subpartDefId}
        AND ei."archivedAt" IS NULL
      JOIN ${schema.FieldValue} child_fv
        ON child_fv."entityId" = ei.id
        AND child_fv."fieldId" = ${spChildField.id}
        AND child_fv."organizationId" = ${organizationId}
      JOIN ${schema.FieldValue} qty_fv
        ON qty_fv."entityId" = ei.id
        AND qty_fv."fieldId" = ${spQtyField.id}
        AND qty_fv."organizationId" = ${organizationId}
      WHERE st.depth < ${MAX_BOM_DEPTH}
    )
    SELECT parent_id, child_id, qty FROM subtree
  `)

  const rows = result.rows as { parent_id: string; child_id: string; qty: number }[]

  // Build adjacency list from CTE results
  const graph = new Map<string, { childId: string; qty: number }[]>()
  for (const row of rows) {
    if (row.parent_id && row.child_id && row.qty > 0) {
      const children = graph.get(row.parent_id) ?? []
      children.push({ childId: row.child_id, qty: row.qty })
      graph.set(row.parent_id, children)
    }
  }

  return graph
}

// ─── Leaf Target Calculation ───────────────────────────────────────────

/**
 * Walk the BOM graph from root and collect all parts with multiplied quantities.
 * Both intermediate and leaf nodes are included (all have tracked inventory).
 * Includes circular reference detection via visited Set and maxDepth safeguard.
 */
function getDeductionTargets(
  rootPartId: string,
  rootQuantity: number,
  graph: Map<string, { childId: string; qty: number }[]>,
  visited: Set<string> = new Set(),
  depth: number = 0
): { partInstanceId: string; quantity: number }[] {
  // Circular reference protection — same pattern as cost-calculator.ts
  if (visited.has(rootPartId)) {
    logger.warn('Circular reference detected in BOM during stock explosion, skipping', {
      partId: rootPartId,
      depth,
    })
    return []
  }

  // Max depth safeguard — defense in depth alongside the CTE's depth limit
  if (depth >= MAX_BOM_DEPTH) {
    logger.warn('Max BOM depth reached during stock explosion, treating as leaf', {
      partId: rootPartId,
      depth,
    })
    return [{ partInstanceId: rootPartId, quantity: rootQuantity }]
  }

  visited.add(rootPartId)

  const children = graph.get(rootPartId)

  // No children = leaf node, just return this part
  if (!children || children.length === 0) {
    return [{ partInstanceId: rootPartId, quantity: rootQuantity }]
  }

  // Has children = include this intermediate node AND recurse into children
  const targets: { partInstanceId: string; quantity: number }[] = [
    { partInstanceId: rootPartId, quantity: rootQuantity },
  ]
  for (const child of children) {
    targets.push(
      ...getDeductionTargets(child.childId, rootQuantity * child.qty, graph, visited, depth + 1)
    )
  }

  // Consolidate: a part may appear multiple times in the tree
  const consolidated = new Map<string, number>()
  for (const t of targets) {
    consolidated.set(t.partInstanceId, (consolidated.get(t.partInstanceId) ?? 0) + t.quantity)
  }

  return [...consolidated.entries()].map(([partInstanceId, quantity]) => ({
    partInstanceId,
    quantity,
  }))
}

// ─── Batch QoH Recalculation ───────────────────────────────────────────

/**
 * Recalculate QoH for multiple parts in one pass.
 * - 1 grouped SUM query for all parts
 * - 1 batch reorder point read
 * - Parallel writes for QoH + stock_status
 * - 1 batched realtime publish
 */
async function batchRecalculateQoH(
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
  const realtimeEntries: Array<{ key: string; value: unknown }> = []

  const insertRows: Array<typeof schema.FieldValue.$inferInsert> = []

  for (const partId of unique) {
    const qoh = qohByPart.get(partId) ?? 0
    const reorderPoint = reorderPoints.get(partId) ?? null
    const status = deriveStockStatus(qoh, reorderPoint)
    const recordId = toRecordId(partDefId, partId) as RecordId

    // QoH field value row
    insertRows.push(
      buildFieldValueRow({
        organizationId,
        entityId: partId,
        entityDefinitionId: partDefId,
        fieldId: qohField.id,
        value: { type: 'number', value: qoh },
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
          value: { type: 'option', optionId: status },
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

  // 1 bulk DELETE: remove existing QoH + status values for all target parts
  const fieldIds = [qohField.id, ...(statusField ? [statusField.id] : [])]
  await database
    .delete(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, unique),
        inArray(schema.FieldValue.fieldId, fieldIds),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  // 1 bulk INSERT: write all new values
  if (insertRows.length > 0) {
    await database.insert(schema.FieldValue).values(insertRows)
  }

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
    fieldType: flagField.type,
    value: { type: 'boolean', value: false },
  })
}

/** Derive stock status from QoH and reorder point. */
function deriveStockStatus(qoh: number, reorderPoint: number | null): string {
  if (qoh <= 0) return 'out_of_stock'
  if (reorderPoint != null && qoh <= reorderPoint) return 'low_stock'
  return 'in_stock'
}

/** Extract a related entity ID from event values. */
function extractRelatedEntityId(
  values: Record<string, unknown>,
  systemAttribute: string
): string | undefined {
  const value = values[systemAttribute]
  if (typeof value !== 'string') return undefined
  return value.includes(':') ? parseRecordId(value as any).entityInstanceId : value
}
