// packages/lib/src/returns/salvage-tree.ts

/**
 * The salvage tree as **pure graph work**: BOM edges plus whatever
 * `return_part_line` rows exist, in, view tree out, with no database anywhere.
 *
 * The warehouse works a returned lift by walking its BOM and grading each
 * subassembly (plan section 6.6). Two properties of that walk are what this
 * file exists to get right, and neither is expressible in the query that loads
 * the data:
 *
 * 1. **Laziness.** A BOM is up to {@link MAX_SALVAGE_DEPTH} deep and nobody
 *    opens all of it, so rows are materialized on first touch. Only the top
 *    level, plus the children of nodes that already have a row, are present. A
 *    node with no row is `undecided` **by absence**, which keeps
 *    `return_part_line` small and makes the salvage writer's input exactly "the
 *    rows somebody actually touched".
 * 2. **Compounding prefill.** A node's prefilled quantity is its BOM quantity
 *    times its parent's quantity, and the top level's parent is the return line
 *    itself. Two lifts returned, each carrying 2 of a subassembly, prefills
 *    that row at 4; a bolt used 3 times in that subassembly prefills at 12.
 *
 * Cycles and the depth cap are handled the way `bom/subpart-graph.ts` handles
 * them - a visited set and a hard depth limit - with one deliberate difference
 * recorded on {@link buildSalvageTree}.
 */

import {
  DEFAULT_SALVAGE_PERCENT,
  MAX_SALVAGE_DEPTH,
  type MaterializedSalvageRow,
  ROOT_SALVAGE_KEY,
  type SalvageNode,
  type SalvagePartInfo,
  type SubpartEdge,
  type SubpartGraph,
} from './types'

/** Everything {@link buildSalvageTree} needs. All of it is plain data. */
export interface BuildSalvageTreeInput {
  /** `loadSubpartGraph(organizationId, rootPartId)`'s adjacency map. */
  graph: SubpartGraph
  /** `return_line.part` - the returned finished good, and the BOM root. */
  rootPartId: string
  /** `return_line.quantity` - how many of the finished good came back. */
  returnLineQuantity: number
  /** Every `return_part_line` row for this return line. Order does not matter. */
  rows: readonly MaterializedSalvageRow[]
  /** Part labels. A part missing from the map is named by its id, never blank. */
  parts: ReadonlyMap<string, SalvagePartInfo>
}

/**
 * Assemble the view tree for one return line.
 *
 * The returned finished good is **not** a node: it does not come back as
 * itself (plan section 6.1), so the roots are its direct subassemblies and
 * their synthetic parent key is {@link ROOT_SALVAGE_KEY}.
 *
 * Ordering within a parent is BOM edge order, and the rows for one part sort
 * among themselves by `sortOrder` then `id`, so a split's two halves keep a
 * stable position. Rows whose part is no longer in the parent's BOM - the BOM
 * was edited after the row was written - are emitted last rather than dropped,
 * because a recorded disposition must never vanish from the screen.
 *
 * 🛑 **The cycle guard is path-scoped, not global.** `getDeductionTargets` in
 * `bom/subpart-graph.ts` shares one visited set across siblings, which is right
 * for a flatten that consolidates quantities and wrong for a view: a part used
 * in two different subassemblies is two rows the warehouse grades separately.
 * A part that reappears **on its own path** is emitted once and not descended
 * into, so the tree stays finite and shows `hasChildren: false` there rather
 * than an expander that re-enters the loop.
 */
export function buildSalvageTree(input: BuildSalvageTreeInput): SalvageNode[] {
  const byParent = groupRowsByParent(input.rows)

  return buildLevel({
    input,
    byParent,
    parentKey: ROOT_SALVAGE_KEY,
    parentRowId: null,
    parentPartId: input.rootPartId,
    parentQuantity: input.returnLineQuantity,
    depth: 0,
    path: new Set<string>([input.rootPartId]),
  })
}

/** Every node in the tree, parents before children. */
export function flattenSalvageTree(roots: readonly SalvageNode[]): SalvageNode[] {
  const out: SalvageNode[] = []
  const walk = (nodes: readonly SalvageNode[]) => {
    for (const node of nodes) {
      out.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(roots)
  return out
}

/** The node with `key`, or undefined. Convenience over {@link flattenSalvageTree}. */
export function findSalvageNode(
  roots: readonly SalvageNode[],
  key: string
): SalvageNode | undefined {
  return flattenSalvageTree(roots).find((node) => node.key === key)
}

/**
 * The BOM quantity of `childPartId` directly under `parentPartId`, or null when
 * there is no such edge.
 *
 * Parallel edges are summed: two `subpart` rows joining the same pair mean the
 * parent uses that many, and taking the first would silently halve the prefill.
 */
export function bomQuantity(
  graph: SubpartGraph,
  parentPartId: string,
  childPartId: string
): number | null {
  const edges = graph.get(parentPartId)
  if (!edges) return null
  let total = 0
  let found = false
  for (const edge of edges) {
    if (edge.childId !== childPartId) continue
    found = true
    total += edge.qty
  }
  return found ? total : null
}

// ─── internals ──────────────────────────────────────────────────────

/** `parentRowId` (null at the top level) -> the rows under it. */
function groupRowsByParent(
  rows: readonly MaterializedSalvageRow[]
): Map<string | null, MaterializedSalvageRow[]> {
  const byParent = new Map<string | null, MaterializedSalvageRow[]>()
  for (const row of rows) {
    const bucket = byParent.get(row.parentId) ?? []
    bucket.push(row)
    byParent.set(row.parentId, bucket)
  }
  return byParent
}

/** Sibling order: `sortOrder` when both have one, then `id`, so it is total. */
function compareRows(a: MaterializedSalvageRow, b: MaterializedSalvageRow): number {
  const aOrder = a.sortOrder ?? ''
  const bOrder = b.sortOrder ?? ''
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

interface LevelContext {
  input: BuildSalvageTreeInput
  byParent: Map<string | null, MaterializedSalvageRow[]>
  parentKey: string
  parentRowId: string | null
  parentPartId: string
  parentQuantity: number
  depth: number
  /** Part ids on the path from the BOM root to this level, for the cycle guard. */
  path: ReadonlySet<string>
}

function buildLevel(ctx: LevelContext): SalvageNode[] {
  if (ctx.depth >= MAX_SALVAGE_DEPTH) return []

  const edges = ctx.input.graph.get(ctx.parentPartId) ?? []
  const rows = [...(ctx.byParent.get(ctx.parentRowId) ?? [])].sort(compareRows)

  const nodes: SalvageNode[] = []
  const placedRowIds = new Set<string>()
  const seenEdgeParts = new Set<string>()

  for (const edge of edges) {
    if (seenEdgeParts.has(edge.childId)) continue
    seenEdgeParts.add(edge.childId)

    const edgeQty = bomQuantity(ctx.input.graph, ctx.parentPartId, edge.childId) ?? edge.qty
    const matching = rows.filter((row) => row.partId === edge.childId)

    if (matching.length === 0) {
      nodes.push(makeSyntheticNode(ctx, edge, edgeQty))
      continue
    }
    for (const row of matching) {
      placedRowIds.add(row.id)
      nodes.push(makeMaterializedNode(ctx, row))
    }
  }

  // Rows whose part is no longer a child of this parent in the BOM. The
  // disposition was recorded against a graph that has since changed; showing
  // it last beats dropping it.
  for (const row of rows) {
    if (placedRowIds.has(row.id)) continue
    nodes.push(makeMaterializedNode(ctx, row))
  }

  return nodes
}

function makeSyntheticNode(ctx: LevelContext, edge: SubpartEdge, edgeQty: number): SalvageNode {
  const info = ctx.input.parts.get(edge.childId)
  const cyclic = ctx.path.has(edge.childId)
  return {
    key: `bom:${ctx.parentKey}:${edge.childId}`,
    partId: edge.childId,
    partName: info?.name ?? edge.childId,
    partNumber: info?.number ?? null,
    depth: ctx.depth,
    quantity: edgeQty * ctx.parentQuantity,
    status: 'undecided',
    salvagePercent: DEFAULT_SALVAGE_PERCENT,
    hasChildren: hasChildren(ctx, edge.childId, null, cyclic),
    materialized: false,
    // Not expanded: an unmaterialized node's children are loaded on first
    // touch, which is the whole of the laziness rule.
    children: null,
  }
}

function makeMaterializedNode(ctx: LevelContext, row: MaterializedSalvageRow): SalvageNode {
  const info = ctx.input.parts.get(row.partId)
  const cyclic = ctx.path.has(row.partId)
  const children = cyclic
    ? []
    : buildLevel({
        ...ctx,
        parentKey: row.id,
        parentRowId: row.id,
        parentPartId: row.partId,
        parentQuantity: row.quantity,
        depth: ctx.depth + 1,
        path: new Set([...ctx.path, row.partId]),
      })

  return {
    key: row.id,
    partId: row.partId,
    partName: info?.name ?? row.partId,
    partNumber: info?.number ?? null,
    depth: ctx.depth,
    quantity: row.quantity,
    status: row.status,
    salvagePercent: row.salvagePercent,
    hasChildren: hasChildren(ctx, row.partId, children, cyclic),
    materialized: true,
    children,
  }
}

/**
 * Whether the UI should offer an expander.
 *
 * False on a cycle and at the depth cap even when the BOM says otherwise:
 * expanding there yields nothing, and an expander that opens onto an empty list
 * reads as a loading bug.
 */
function hasChildren(
  ctx: LevelContext,
  partId: string,
  builtChildren: SalvageNode[] | null,
  cyclic: boolean
): boolean {
  if (cyclic) return false
  if (ctx.depth + 1 >= MAX_SALVAGE_DEPTH) return false
  if (builtChildren && builtChildren.length > 0) return true
  return (ctx.input.graph.get(partId)?.length ?? 0) > 0
}
