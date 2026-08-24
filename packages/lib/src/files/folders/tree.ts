// packages/lib/src/files/folders/tree.ts

/**
 * The folder hierarchy as a **pure graph**: path computation, cycle detection,
 * ancestor/descendant walks and tree assembly, with no database anywhere.
 *
 * `core/folder-service.ts` reached these algorithms only through a `db`-bound
 * service, so none of them could be exercised without a Drizzle stub, and three
 * defects lived in them undetected:
 *
 * 1. **`getAncestors` could not terminate on cyclic data.** Its `while
 *    (currentId)` loop had no visited set, so one `A → B → A` pair — which the
 *    schema permits, since `Folder.parentId` is a self-reference with no check
 *    constraint — hung the request and grew an array until the heap gave out.
 *    Every walk below carries a visited set and is proven against a cycle.
 * 2. **Cycle detection compared *paths*, not parent links.** `newParent.path
 *    ?.startsWith(folder.path + '/')` answers the question only while every
 *    `path` column is accurate — and `rebuildPaths` exists precisely because
 *    they drift. A stale path let a folder be moved under its own descendant,
 *    which is how a cycle got into the data in the first place.
 *    {@link wouldCreateCycle} walks `parentId`, which is the authoritative edge.
 * 3. **`buildTree` dropped orphans.** A node whose parent was soft-deleted has a
 *    non-null `parentId` pointing at a row the query filtered out, so it was
 *    neither pushed to the roots nor found a parent to attach to — it vanished
 *    from the tree the UI renders while still existing and still holding files.
 *    {@link buildFolderTree} surfaces an unreachable parent as a root.
 *
 * Everything here takes plain data and returns plain data, so its tests need no
 * stub at all (`plans/attachments/09-testing-strategy.md` §9.2, shape 1).
 */

/**
 * The projection every graph function below works on.
 *
 * Deliberately not `FolderEntity`: the algorithms need four columns, and a
 * narrow shape is what lets `folder-queries.ts` load the whole organization's
 * hierarchy in one small `SELECT` instead of every folder row in full.
 */
export interface FolderNode {
  id: string
  parentId: string | null
  name: string
  path: string | null
  depth: number
}

/** What {@link buildFolderTree} renders, plus the per-folder aggregates it folds in. */
export interface FolderTreeNode {
  id: string
  name: string
  path: string
  depth: number
  parentId?: string
  children: FolderTreeNode[]
  fileCount: number
  totalSize: number
}

/** Per-folder aggregates {@link buildFolderTree} folds into its nodes. */
export interface FolderAggregate {
  fileCount: number
  totalSize: number
}

/** The path of the notional root every top-level folder hangs off. */
export const ROOT_PATH = '/'

/**
 * Characters a folder name may not contain.
 *
 * Carried over verbatim from `FolderService.validateName` — the Windows-illegal
 * set plus `/`, which would otherwise let a name forge a path separator and
 * make {@link joinPath} produce a path that claims a different position in the
 * tree than the `parentId` edge says.
 */
const INVALID_NAME_CHARS = /[<>:"/\\|?*]/

/**
 * Join a parent path and a child name into a canonical absolute path.
 *
 * Byte-for-byte the behaviour of the private `FolderService.pathJoin`: a null,
 * undefined or `'/'` parent yields `/name`, repeated separators collapse, and
 * the result always starts with `/`.
 */
export function joinPath(parentPath: string | null | undefined, name: string): string {
  const joined = [parentPath === ROOT_PATH || !parentPath ? '' : parentPath, name]
    .join('/')
    .replace(/\/+/g, '/')
  return joined.startsWith('/') ? joined : `/${joined}`
}

/**
 * The prefix that matches a folder's descendants and nothing else.
 *
 * The trailing slash is the whole point: `'/Doc'` is a prefix of
 * `'/Documents/report.pdf'`, `'/Doc/'` is not. The legacy cascade paths used the
 * slash-less form for `FolderFile` and the slashed form for `Folder` in the same
 * statement pair — see the note on `deleteFolder` in `folder-mutations.ts`.
 */
export function pathPrefix(path: string | null | undefined): string {
  if (!path || path === ROOT_PATH) return ROOT_PATH
  return `${path}/`
}

/**
 * Escape the `LIKE` metacharacters in a value used as a literal prefix.
 *
 * `ilike(col, `${path}%`)` treats `%` and `_` **inside the folder name** as
 * wildcards, so a folder called `100%_off` matched — and cascaded deletes into —
 * unrelated siblings. Postgres's default `LIKE` escape is backslash, so no
 * `ESCAPE` clause is needed alongside this.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Collapse the UI's `'root'` sentinel to the `null` the column actually stores.
 *
 * `fileRouter.move` types its target as `z.union([z.string(), z.null(),
 * z.literal('root')])` and `FilesystemService` forwards the raw value, so
 * `'root'` genuinely reaches the folder move path. Left unhandled it is a
 * lookup for a folder whose id is the literal string `root`.
 */
export function normalizeParentId(parentId: string | null | undefined): string | null {
  if (parentId === undefined || parentId === null || parentId === 'root') return null
  return parentId
}

/**
 * Whether a name is structurally usable as a folder name.
 *
 * Uniqueness is a database question and lives in `folder-queries.ts`; this is
 * the half that needs no I/O.
 */
export function isValidFolderName(name: string): boolean {
  if (!name || name.trim().length === 0) return false
  return !INVALID_NAME_CHARS.test(name)
}

/**
 * The absolute path a folder named `name` would have under `ancestors`.
 *
 * `ancestors` is ordered **root first**, exactly as {@link ancestorsOf} returns
 * it, so `computePath(ancestorsOf(index, parentId).concat(parent), name)` and a
 * fold over {@link joinPath} agree by construction.
 *
 * This is the function `rebuildPaths` and every create/rename/move share. It
 * used to be a `private async computeNewFolderPath` that issued a query for the
 * parent row, which is why nothing could test it.
 */
export function computePath(ancestors: ReadonlyArray<{ name: string }>, name: string): string {
  let path: string | null = null
  for (const ancestor of ancestors) {
    path = joinPath(path, ancestor.name)
  }
  return joinPath(path, name)
}

/** Index nodes by id. Later duplicates win, matching `Map` semantics. */
export function indexById(nodes: readonly FolderNode[]): Map<string, FolderNode> {
  const index = new Map<string, FolderNode>()
  for (const node of nodes) index.set(node.id, node)
  return index
}

/** Index nodes by `parentId`, `null` collecting the roots. Children keep input order. */
export function indexByParent(nodes: readonly FolderNode[]): Map<string | null, FolderNode[]> {
  const index = new Map<string | null, FolderNode[]>()
  for (const node of nodes) {
    const bucket = index.get(node.parentId) ?? []
    bucket.push(node)
    index.set(node.parentId, bucket)
  }
  return index
}

/**
 * The chain from the root down to `id`'s immediate parent.
 *
 * Excludes `id` itself. Stops early — returning the partial chain — when the
 * walk reaches a `parentId` that is not in the index (a soft-deleted or
 * cross-organization parent) or revisits a node it has already seen (a cycle).
 * **Neither case throws and neither loops**, which is the property the legacy
 * `getAncestors` lacked.
 */
export function ancestorsOf(index: ReadonlyMap<string, FolderNode>, id: string): FolderNode[] {
  const chain: FolderNode[] = []
  const seen = new Set<string>([id])
  let cursor = index.get(id)?.parentId ?? null

  while (cursor && !seen.has(cursor)) {
    const ancestor = index.get(cursor)
    if (!ancestor) break
    seen.add(cursor)
    chain.push(ancestor)
    cursor = ancestor.parentId
  }

  // Collected leaf-first; the contract is root-first.
  return chain.reverse()
}

/**
 * Every folder beneath `id`, breadth-first. Excludes `id` itself.
 *
 * Walks `parentId` edges rather than matching a path prefix, so it is correct
 * against stale `path` columns and against names containing `LIKE`
 * metacharacters. A cycle below `id` is visited once and not re-entered.
 */
export function descendantsOf(nodes: readonly FolderNode[], id: string): FolderNode[] {
  const byParent = indexByParent(nodes)
  const out: FolderNode[] = []
  const seen = new Set<string>([id])
  const queue: string[] = [id]

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      queue.push(child.id)
    }
  }

  return out
}

/**
 * Would re-parenting `folderId` under `newParentId` close a loop?
 *
 * Answered by walking **up** from the proposed parent: if the walk reaches
 * `folderId`, the proposed parent is already below it. Three cases the
 * path-comparison version got wrong:
 *
 * - `folderId === newParentId` — self-parenting, `true`.
 * - a proposed parent whose `path` is stale or null — the path version returned
 *   `false` and let the cycle through; this one still sees the edge.
 * - a graph that **already** contains a cycle — the path version could recurse
 *   forever through `getAncestors`; the visited set bounds this walk at the
 *   number of nodes.
 *
 * A `newParentId` that is not in the index returns `false`: "that parent does
 * not exist" is a different failure, and reporting it is the caller's job.
 */
export function wouldCreateCycle(
  nodes: readonly FolderNode[] | ReadonlyMap<string, FolderNode>,
  folderId: string,
  newParentId: string | null
): boolean {
  if (!newParentId) return false
  if (folderId === newParentId) return true

  const index = nodes instanceof Map ? nodes : indexById(nodes as readonly FolderNode[])
  if (!index.has(newParentId)) return false

  const seen = new Set<string>()
  let cursor: string | null = newParentId

  while (cursor) {
    if (cursor === folderId) return true
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = index.get(cursor)?.parentId ?? null
  }

  return false
}

/**
 * Is `ancestorId` somewhere above `descendantId`?
 *
 * A folder is never its own ancestor, matching the legacy `isAncestor`. Shares
 * {@link wouldCreateCycle}'s upward walk, so both answers come from the same
 * edges and cannot disagree.
 */
export function isAncestorOf(
  nodes: readonly FolderNode[] | ReadonlyMap<string, FolderNode>,
  ancestorId: string,
  descendantId: string
): boolean {
  if (ancestorId === descendantId) return false
  return wouldCreateCycle(nodes, ancestorId, descendantId)
}

/** One folder's corrected position, as {@link computeTreeShape} reports it. */
export interface FolderShape {
  id: string
  path: string
  depth: number
}

/**
 * Recompute every folder's `path` and `depth` from the `parentId` edges alone.
 *
 * This is the pure core of both `rebuildPaths` and `fixDepths`, which between
 * them issued **two queries per folder** (one to fetch the parent for the path,
 * one for the parent's depth) inside a loop over every folder in the
 * organization. Here it is one pass over an already-loaded array.
 *
 * `depth` is the length of the ancestor chain, so a folder whose parent is
 * missing from `nodes` is treated as a root — which is what "the parent was
 * deleted" should mean, and what the legacy `getParentDepth` accidentally did
 * anyway by returning `0` for a missing parent.
 */
export function computeTreeShape(nodes: readonly FolderNode[]): FolderShape[] {
  const index = indexById(nodes)
  return nodes.map((node) => {
    const ancestors = ancestorsOf(index, node.id)
    return {
      id: node.id,
      path: computePath(ancestors, node.name),
      depth: ancestors.length,
    }
  })
}

/** Only the folders whose stored `path`/`depth` disagree with {@link computeTreeShape}. */
export function driftedShapes(nodes: readonly FolderNode[]): FolderShape[] {
  const index = indexById(nodes)
  const shapes = computeTreeShape(nodes)
  return shapes.filter((shape) => {
    const node = index.get(shape.id)
    if (!node) return false
    return node.path !== shape.path || node.depth !== shape.depth
  })
}

/**
 * Assemble a flat node list into the nested tree the folder sidebar renders.
 *
 * `aggregates` supplies `fileCount` / `totalSize` per folder id; a folder absent
 * from the map gets zeros. The legacy `buildTree` read `folder._count?.files`,
 * a Prisma field Drizzle never produces, so **every node's `fileCount` and
 * `totalSize` were unconditionally `0`** — and the query feeding it eagerly
 * loaded every file row in the organization to compute them.
 *
 * A node whose `parentId` names a folder not present in `nodes` is emitted as a
 * root rather than dropped; see the file header.
 *
 * The result is always a forest, never a graph: nodes are attached by walking
 * **down** from the roots with a visited set, so a `A → B → A` pair in the data
 * surfaces as two roots instead of a structure that hangs `JSON.stringify` — the
 * shape a tRPC response goes through.
 */
export function buildFolderTree(
  nodes: readonly FolderNode[],
  aggregates: ReadonlyMap<string, FolderAggregate> = new Map()
): FolderTreeNode[] {
  const byId = new Map<string, FolderTreeNode>()
  for (const node of nodes) {
    const aggregate = aggregates.get(node.id)
    byId.set(node.id, {
      id: node.id,
      name: node.name,
      path: node.path ?? ROOT_PATH,
      depth: node.depth,
      parentId: node.parentId ?? undefined,
      children: [],
      fileCount: aggregate?.fileCount ?? 0,
      totalSize: aggregate?.totalSize ?? 0,
    })
  }

  const byParent = indexByParent(nodes)
  const roots: FolderTreeNode[] = []
  const attached = new Set<string>()

  /** Attach `seed`'s subtree, refusing to revisit a node already placed. */
  const attachSubtree = (seed: FolderNode) => {
    attached.add(seed.id)
    const queue: string[] = [seed.id]
    while (queue.length > 0) {
      const currentId = queue.shift() as string
      const currentNode = byId.get(currentId)
      if (!currentNode) continue
      for (const child of byParent.get(currentId) ?? []) {
        if (attached.has(child.id)) continue
        const childNode = byId.get(child.id)
        if (!childNode) continue
        attached.add(child.id)
        currentNode.children.push(childNode)
        queue.push(child.id)
      }
    }
  }

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) continue
    const treeNode = byId.get(node.id)
    if (!treeNode || attached.has(node.id)) continue
    roots.push(treeNode)
    attachSubtree(node)
  }

  // Anything still unattached sits in a cycle and has no reachable root. Emit
  // each such node as a root so the folder disappears from no view at all.
  for (const node of nodes) {
    if (attached.has(node.id)) continue
    const treeNode = byId.get(node.id)
    if (!treeNode) continue
    roots.push(treeNode)
    attachSubtree(node)
  }

  return roots
}
