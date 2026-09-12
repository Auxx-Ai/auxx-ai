// packages/lib/src/returns/salvage-reads.ts

/**
 * The salvage tree, assembled: the bill of materials, the rows somebody has
 * actually touched, and `buildSalvageTree` over the two.
 *
 * plans/money/tasks/54-returns.md section 6.6.
 *
 * 🛑 **Lazy, and the laziness is a property of the assembly rather than of the
 * query.** `loadSubpartGraph` returns the whole subtree in one recursive CTE -
 * the plan says to use it and reinvent nothing - but `buildSalvageTree` only
 * descends into nodes that already have a `return_part_line` row. So the tree
 * that comes back is the top level plus the children of nodes somebody opened,
 * never the whole bill of materials, and a node with no row is `undecided` by
 * absence. That is also why the part-label read below is scoped to the nodes
 * that can actually be emitted rather than to every part in the graph.
 *
 * Reads only, no permission checks: the router asserts.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { loadSubpartGraph } from '../bom/subpart-graph'
import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import type { RecordId } from '../resources/resource-id'
import { guard } from './guard'
import {
  type ReturnLineRecord,
  type ReturnPartLineRecord,
  readReturnPartLines,
  requireReturnLine,
} from './reads'
import { buildSalvageTree } from './salvage-tree'
import type { MaterializedSalvageRow, SalvageNode, SalvagePartInfo, SubpartGraph } from './types'

/** Everything the salvage card needs for one return line. */
export interface SalvageTreeView {
  returnLineId: string
  recordId: RecordId
  /** `return_line.part`: the returned finished good, and the BOM root. */
  rootPartId: string
  /** `return_line.quantity`: what every top-level prefill is multiplied by. */
  returnLineQuantity: number
  /** The top level, plus the children of every node that has a row. */
  nodes: SalvageNode[]
}

/**
 * The salvage tree for one return line.
 *
 * Four reads and no loop: the line, its materialized rows, the bill of
 * materials, and the part labels for the nodes those three can produce.
 *
 * Refuses a line with no part rather than returning an empty tree: `part` is
 * `required: true` on `return_line` precisely because it is the BOM root, and a
 * line without one is a data fault the warehouse should be told about, not an
 * assembly with nothing in it.
 */
export async function readSalvageTree(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      const line = await requireReturnLine(db, organizationId, returnLineId)
      const rows = await readReturnPartLines(db, organizationId, returnLineId)
      return assembleSalvageTree(db, organizationId, line, rows)
    },
    'Failed to read salvage tree',
    { organizationId, returnLineId }
  )
}

/**
 * {@link readSalvageTree}'s body, over rows the caller already holds.
 *
 * Exported for the write paths: every salvage mutation answers with the
 * refreshed tree, and re-reading the line it just wrote to would be a second
 * round trip for data it is holding.
 */
export async function assembleSalvageTree(
  db: Database,
  organizationId: string,
  line: ReturnLineRecord,
  rows: readonly ReturnPartLineRecord[]
): Promise<SalvageTreeView> {
  const rootPartId = line.partId
  if (!rootPartId) {
    throw new UnprocessableEntityError(
      'This return line names no part, so there is no bill of materials to inspect'
    )
  }

  const graph = await loadSubpartGraph(organizationId, rootPartId)
  const returnLineQuantity = line.quantity ?? 0
  const materialized = rows.map(toMaterializedRow)
  const parts = await readSalvagePartInfos(
    db,
    organizationId,
    reachablePartIds(graph, rootPartId, materialized)
  )

  return {
    returnLineId: line.returnLineId,
    recordId: line.recordId,
    rootPartId,
    returnLineQuantity,
    nodes: buildSalvageTree({
      graph,
      rootPartId,
      returnLineQuantity,
      rows: materialized,
      parts,
    }),
  }
}

/** A stored row, narrowed to what the pure tree builder reads. */
export function toMaterializedRow(row: ReturnPartLineRecord): MaterializedSalvageRow {
  return {
    id: row.id,
    parentId: row.parentId,
    partId: row.partId,
    quantity: row.quantity,
    status: row.status,
    salvagePercent: row.salvagePercent,
    sortOrder: row.sortOrder,
  }
}

/**
 * Part labels for a set of parts, keyed by id.
 *
 * The name is `EntityInstance.displayName` rather than a `part_title` field
 * read: it is the denormalized display value the rest of the product shows, so
 * the tree cannot disagree with the part picker about what a part is called.
 * `part_sku` is the number, left null when the organization does not use SKUs -
 * they are optional, and blank ones are the norm at small stores.
 */
export async function readSalvagePartInfos(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, SalvagePartInfo>> {
  const infos = new Map<string, SalvagePartInfo>()
  const unique = [...new Set(partIds)]
  if (unique.length === 0) return infos

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_sku'] as const)

  const skuValue = alias(schema.FieldValue, 'salvage_part_sku_v')
  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      sku: skuValue.valueText,
    })
    .from(schema.EntityInstance)
    .leftJoin(
      skuValue,
      and(
        eq(skuValue.entityId, schema.EntityInstance.id),
        eq(skuValue.organizationId, schema.EntityInstance.organizationId),
        eq(skuValue.fieldId, fields.part_sku?.id ?? '')
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, unique),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    infos.set(row.id, { name: row.displayName ?? row.id, number: row.sku })
  }
  return infos
}

/**
 * The parts a built tree can actually name.
 *
 * The BOM root's direct children (the top level), every materialized row's own
 * part, and the direct children of each of those - which is exactly the set
 * `buildSalvageTree` emits, because it descends into a node only when that node
 * has a row. Labelling the whole graph instead would read every part in a
 * twenty-deep bill of materials to render two levels.
 */
function reachablePartIds(
  graph: SubpartGraph,
  rootPartId: string,
  rows: readonly MaterializedSalvageRow[]
): string[] {
  const ids = new Set<string>()
  const addChildren = (partId: string) => {
    for (const edge of graph.get(partId) ?? []) ids.add(edge.childId)
  }

  addChildren(rootPartId)
  for (const row of rows) {
    ids.add(row.partId)
    addChildren(row.partId)
  }
  return [...ids]
}
