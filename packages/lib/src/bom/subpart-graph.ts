// packages/lib/src/bom/subpart-graph.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache, requireCachedEntityDefId } from '../cache'

const logger = createScopedLogger('bom:subpart-graph')

const MAX_BOM_DEPTH = 20

// ─── Subpart Graph Loader ────────────────────────────────────────────

/**
 * Load the subpart graph for a specific part's subtree using a recursive CTE.
 * Returns only the parent→child edges reachable from rootPartId.
 *
 * The CTE has a depth limit (MAX_BOM_DEPTH) which:
 * 1. Scopes the query to only relevant relationships (not entire org)
 * 2. Prevents infinite recursion from circular BOM refs at the DB level
 * 3. Acts as a safety valve for unreasonably deep BOMs
 */
export async function loadSubpartGraph(
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

// ─── Direct Subparts (depth 1) ───────────────────────────────────

/**
 * Load only the DIRECT (depth-1) subparts of a part.
 *
 * Deliberately a separate function from {@link loadSubpartGraph} +
 * {@link getDeductionTargets} rather than a depth flag on them (B4).
 * A build consumes one level: a subassembly is produced by its own build and
 * carries its own on-hand balance, so deducting its children as well would
 * consume the same material twice. The multi-level walk stays correct for
 * backflush-at-sale, which is why both shapes exist and why they must stay
 * visibly different functions that nobody can conflate by passing the wrong
 * depth.
 *
 * Same edge semantics as `loadSubpartGraph`'s base case: non-archived `subpart`
 * instances in the org whose `subpart_parent_part` points at `partInstanceId`,
 * carrying a positive `subpart_quantity`.
 *
 * @returns One entry per direct child edge. Empty when the part has no BOM, or
 *   when the `subpart` fields are not materialized in this org.
 */
export async function loadDirectSubparts(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<{ childId: string; qty: number }[]> {
  const cache = getOrgCache()
  const subpartDefId = await requireCachedEntityDefId(organizationId, 'subpart')

  const cfFields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['subpart_parent_part', 'subpart_child_part', 'subpart_quantity'] as const)

  const spParentField = cfFields.subpart_parent_part
  const spChildField = cfFields.subpart_child_part
  const spQtyField = cfFields.subpart_quantity

  if (!spParentField || !spChildField || !spQtyField) return []

  const parentFv = alias(schema.FieldValue, 'parent_fv')
  const childFv = alias(schema.FieldValue, 'child_fv')
  const qtyFv = alias(schema.FieldValue, 'qty_fv')

  const rows = await db
    .select({ childId: childFv.relatedEntityId, qty: qtyFv.valueNumber })
    .from(schema.EntityInstance)
    .innerJoin(
      parentFv,
      and(
        eq(parentFv.entityId, schema.EntityInstance.id),
        eq(parentFv.fieldId, spParentField.id),
        eq(parentFv.organizationId, organizationId),
        eq(parentFv.relatedEntityId, partInstanceId)
      )
    )
    .innerJoin(
      childFv,
      and(
        eq(childFv.entityId, schema.EntityInstance.id),
        eq(childFv.fieldId, spChildField.id),
        eq(childFv.organizationId, organizationId)
      )
    )
    .innerJoin(
      qtyFv,
      and(
        eq(qtyFv.entityId, schema.EntityInstance.id),
        eq(qtyFv.fieldId, spQtyField.id),
        eq(qtyFv.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, subpartDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const edges: { childId: string; qty: number }[] = []
  for (const row of rows) {
    const qty = Number(row.qty ?? 0)
    if (row.childId && qty > 0) {
      edges.push({ childId: row.childId, qty })
    }
  }

  return edges
}

/**
 * Walk the BOM graph from root and collect all DESCENDANT parts with multiplied
 * quantities. The root itself is excluded — the user-submitted parent movement
 * already accounts for the root's deduction. Both intermediate and leaf
 * descendants are included (all have tracked inventory).
 * Includes circular reference detection via visited Set and maxDepth safeguard.
 */
export function getDeductionTargets(
  rootPartId: string,
  rootQuantity: number,
  graph: Map<string, { childId: string; qty: number }[]>,
  visited: Set<string> = new Set(),
  depth: number = 0,
  isRoot: boolean = true
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
    return isRoot ? [] : [{ partInstanceId: rootPartId, quantity: rootQuantity }]
  }

  visited.add(rootPartId)

  const children = graph.get(rootPartId)

  // No children = leaf node. Skip if this is the root (parent movement covers it).
  if (!children || children.length === 0) {
    return isRoot ? [] : [{ partInstanceId: rootPartId, quantity: rootQuantity }]
  }

  // Has children = include this node (unless it's the root) AND recurse into children
  const targets: { partInstanceId: string; quantity: number }[] = isRoot
    ? []
    : [{ partInstanceId: rootPartId, quantity: rootQuantity }]
  for (const child of children) {
    targets.push(
      ...getDeductionTargets(
        child.childId,
        rootQuantity * child.qty,
        graph,
        visited,
        depth + 1,
        false
      )
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
