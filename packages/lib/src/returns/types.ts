// packages/lib/src/returns/types.ts

/**
 * The shapes the returns salvage logic is written against.
 *
 * Nothing here imports anything: `client.ts` re-exports this file for the
 * browser, every pure module below imports it, and keeping the declarations in
 * their own file is what stops `client.ts -> salvage-tree.ts -> client.ts` from
 * becoming a real import cycle.
 *
 * See `plans/money/tasks/54-returns.md` sections 3.5, 3.6, 6.3, 6.4 and 6.6.
 */

/**
 * `return_part_line.status` (plan section 3.6).
 *
 * `undecided` is also what a node with **no row at all** reads as: the tree is
 * materialized lazily, so absence is the default rather than a stored value
 * (plan section 6.6, "Materialize rows lazily, not on create").
 */
export type SalvageStatus = 'good' | 'damaged' | 'scrap' | 'missing' | 'undecided'

/** Every `SalvageStatus`, for exhaustive UI selectors and validation. */
export const SALVAGE_STATUSES = [
  'good',
  'damaged',
  'scrap',
  'missing',
  'undecided',
] as const satisfies readonly SalvageStatus[]

/** `return_part_line.salvagePercent` when nobody has said otherwise (plan section 6.4). */
export const DEFAULT_SALVAGE_PERCENT = 100

/**
 * The synthetic parent key the top level of the tree hangs off.
 *
 * The returned part itself is **not** a node: a returned lift does not come
 * back as a lift (plan section 6.1), so the tree starts at its direct
 * subassemblies and they need a stable parent key for {@link SalvageNode.key}'s
 * `bom:${parentKey}:${partId}` form.
 */
export const ROOT_SALVAGE_KEY = 'root'

/**
 * Depth the walk refuses to go past, mirroring `MAX_BOM_DEPTH` in
 * `bom/subpart-graph.ts`.
 *
 * Duplicated rather than imported on purpose: `subpart-graph.ts` imports
 * `@auxx/database`, and this file has to stay loadable in a browser bundle.
 * The two numbers describe the same guard and must move together.
 */
export const MAX_SALVAGE_DEPTH = 20

/** One BOM edge, exactly as `loadSubpartGraph` returns it in its adjacency map. */
export interface SubpartEdge {
  childId: string
  qty: number
}

/** `loadSubpartGraph`'s return shape: `parentPartId -> child edges`. */
export type SubpartGraph = ReadonlyMap<string, readonly SubpartEdge[]>

/** What the tree needs to label a part. Anything else belongs to the query, not here. */
export interface SalvagePartInfo {
  name: string
  number: string | null
}

/**
 * A `return_part_line` row that actually exists.
 *
 * `parentId` is the parent **row's** id, not a part id, and is null for a row
 * at the top level of a return line's tree. Several rows may share a
 * `(parentId, partId)` pair: that is the split button (plan section 6.6), one
 * row per disposition.
 */
export interface MaterializedSalvageRow {
  id: string
  parentId: string | null
  partId: string
  quantity: number
  status: SalvageStatus
  salvagePercent: number
  /** Fractional index. Ties and nulls fall back to `id` so the order is total. */
  sortOrder?: string | null
}

/**
 * One row of the salvage tree the warehouse works through.
 *
 * 🛑 This shape is a contract other surfaces are built against. `children:
 * null` means "not expanded yet", which is different from `[]` ("expanded, no
 * children"), and `materialized: false` means no `return_part_line` row exists,
 * which is what makes `status: 'undecided'` true by absence.
 */
export interface SalvageNode {
  /** `return_part_line` id, or `bom:${parentKey}:${partId}` when not yet materialized. */
  key: string
  partId: string
  partName: string
  partNumber: string | null
  depth: number
  /** Prefilled BOM qty x the parent's quantity, editable once materialized. */
  quantity: number
  status: SalvageStatus
  /** Default {@link DEFAULT_SALVAGE_PERCENT}. */
  salvagePercent: number
  hasChildren: boolean
  /** Does a `return_part_line` row exist. */
  materialized: boolean
  /** `null` means not yet expanded. */
  children: SalvageNode[] | null
}
