// packages/lib/src/files/folders/folder-mutations.ts

/**
 * `Folder` writes.
 *
 * Reads live in `folders/folder-queries.ts`, the graph algorithms in
 * `folders/tree.ts` — `docs/lib-module-guide.md` §5.
 *
 * ## Three defects this file fixes, deliberately and not silently
 *
 * **1. Every `UPDATE` and `DELETE` now carries the organization filter.** The
 * legacy bodies pre-checked existence with an org-scoped `get(id)` and then
 * wrote with `where(eq(Folder.id, id))` alone — `update`, `delete`, `restore`,
 * `merge` and, worst, `permanentDelete`, which is a **hard** `DELETE`. The
 * pre-check made none of them exploitable on their own, but "the guard is in a
 * different statement from the write" is exactly the shape PR 5b found already
 * broken on `AttachmentService.detachFromEntity`. Org scope is in the statement
 * here, unconditionally.
 *
 * **2. The cascade no longer matches paths by prefix.** Delete, restore,
 * permanent delete and the deep counts all used
 * `ilike(FolderFile.path, `${folder.path}%`)` — **without a trailing slash**,
 * while the sibling `Folder` statement in the same transaction used
 * `pathPrefix()`, which adds one. So deleting `/Doc` soft-deleted every file
 * under `/Documents` too, and `permanentDelete` erased them. `ilike` also made
 * `%` and `_` in a folder name into wildcards. Membership is now
 * `folderId IN (subtree)` / `id IN (subtree)`, computed from the `parentId`
 * edges — a real foreign key, which cannot drift and has no metacharacters.
 *
 * **3. Cycle detection walks parent links, not paths.** See `tree.ts`.
 *
 * ## Transaction discipline
 *
 * Anything that writes more than one row takes `tx: Transaction` positionally
 * first, per `files/ctx.ts`. The legacy code called `BaseService.getTx()`, which
 * inspected `typeof db.transaction` at runtime to guess whether it was already
 * inside one — Phase 6 §6.2. A function handed its transaction cannot guess,
 * because the caller already decided.
 *
 * `createFolder` and `ensureFolderPath` take `ctx` instead: the first is a
 * single `INSERT`, and the second is a sequence of them that the legacy
 * `ensurePath` also ran without a transaction. Both are noted where they sit.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import { and, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import {
  findFolderByNameAndParent,
  folderScope,
  loadFolderNodes,
  requireFolder,
} from './folder-queries'
import type { FolderCopyDeps, FolderWriteDeps } from './ports'
import type { FolderNode } from './tree'
import {
  ancestorsOf,
  computePath,
  descendantsOf,
  indexById,
  isValidFolderName,
  joinPath,
  normalizeParentId,
  wouldCreateCycle,
} from './tree'

// ============= Inputs =============

/**
 * Everything needed to create one folder.
 *
 * **No `organizationId`.** The legacy `processCreateData` read
 * `data.organizationId || this.requireOrganization()`, so a caller could write a
 * row into an organization it was not acting for. Scope comes from `ctx`, as in
 * `assets/asset-mutations.ts` and `storage/locations.ts`.
 */
export interface CreateFolderInput {
  name: string
  /** `null`, `undefined` and the UI's `'root'` all mean "at the top level". */
  parentId?: string | null
  /** The actor to attribute the row to. `Folder.createdById` is nullable. */
  createdById?: string | null
}

/**
 * The mutable fields of a folder.
 *
 * `parentId: null` moves the folder to the root; **omitting `parentId` leaves
 * the parent alone**. That distinction is load-bearing — `folderRouter.update`
 * carries a comment about it — and a closed input type is what keeps it
 * expressible, where the legacy `.set({ ...data })` would have accepted any key.
 */
export interface UpdateFolderInput {
  name?: string
  parentId?: string | null
}

/** Everything needed to copy a folder subtree. */
export interface CopyFolderInput {
  sourceId: string
  targetParentId: string | null
  /** Defaults to `Copy of <source name>`, matching the legacy `copy`. */
  newName?: string
  createdById?: string | null
}

// ============= Writes =============

/**
 * Create one folder.
 *
 * A single `INSERT`, so it takes `ctx` rather than a `Transaction`; a caller
 * already inside one passes `{ ...ctx, db: tx }`.
 *
 * `path` and `depth` are derived from the parent's stored values, which is what
 * the legacy `computeNewFolderPath` / `getParentDepth` pair did in two extra
 * queries. If the parent's own path has drifted the child inherits the drift —
 * that is what `maintenance.ts`'s `rebuildFolderPaths` is for, and paying a
 * full-hierarchy read on every create to avoid it is not a trade worth making.
 *
 * Fails with `ConflictError` (409) rather than the legacy bare `Error` (500)
 * when the name is taken, mirroring the
 * `Folder_organizationId_parentId_name_key` unique index.
 */
export async function createFolder(
  ctx: FilesCtx,
  input: CreateFolderInput,
  deps: FolderWriteDeps
): Promise<Result<FolderEntity, AuxxError>> {
  return guard(async () => insertFolder(ctx, input, deps), 'Failed to create folder', {
    name: input.name,
    organizationId: ctx.organizationId,
  })
}

/**
 * Rename and/or re-parent one folder, repairing the subtree's paths.
 *
 * The single write entry point behind {@link renameFolder} and
 * {@link moveFolder}. Order of operations, all inside the caller's transaction:
 *
 * 1. existence, name validity, name-collision in the *target* parent
 * 2. cycle check against the `parentId` graph
 * 3. `UPDATE` the folder itself — org-scoped
 * 4. recompute and `UPDATE` every descendant's `path` and `depth`, and every
 *    file's `path`, from the new shape
 *
 * Step 4 recomputes rather than string-replacing. The legacy version built a
 * `RegExp` from the old path (escaped, at least) and replaced the prefix, which
 * silently no-ops when the stored path did not actually start with the prefix —
 * so a subtree that had already drifted stayed drifted.
 */
export async function updateFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string,
  input: UpdateFolderInput,
  deps: FolderWriteDeps
): Promise<Result<FolderEntity, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      const folder = await requireFolder(txCtx, folderId)

      const renaming = input.name !== undefined && input.name !== folder.name
      const reparenting = input.parentId !== undefined
      const nextName = input.name ?? folder.name
      const nextParentId = reparenting ? normalizeParentId(input.parentId) : folder.parentId

      if (renaming && !isValidFolderName(nextName)) {
        throw new BadRequestError(`'${nextName}' is not a valid folder name`)
      }

      if (renaming || nextParentId !== folder.parentId) {
        await assertNameAvailable(txCtx, nextName, nextParentId, folderId)
      }

      const nodes = await loadFolderNodes(txCtx)
      const index = indexById(nodes)

      if (nextParentId !== folder.parentId && nextParentId !== null) {
        if (!index.has(nextParentId)) {
          throw new NotFoundError(`Target parent folder ${nextParentId} not found`)
        }
        if (wouldCreateCycle(index, folderId, nextParentId)) {
          throw new ConflictError('Move would place the folder inside its own subtree')
        }
      }

      const now = deps.now()
      const parentChain = nextParentId
        ? [...ancestorsOf(index, nextParentId), index.get(nextParentId) as FolderNode]
        : []
      const path = computePath(parentChain, nextName)
      const depth = parentChain.length

      const [updated] = await tx
        .update(schema.Folder)
        .set({
          name: nextName,
          parentId: nextParentId,
          path,
          depth,
          updatedAt: now,
        })
        .where(folderScope(txCtx, [eq(schema.Folder.id, folderId)]))
        .returning()

      if (!updated) throw new NotFoundError(`Folder ${folderId} not found`)

      if (path !== folder.path || depth !== folder.depth) {
        await reshapeSubtree(
          tx,
          txCtx,
          nodes,
          { ...(index.get(folderId) as FolderNode), name: nextName, parentId: nextParentId },
          path,
          depth,
          now
        )
      }

      return updated as FolderEntity
    },
    'Failed to update folder',
    { folderId, organizationId: ctx.organizationId }
  )
}

/** Rename a folder in place. A thin spelling of {@link updateFolder}. */
export async function renameFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string,
  newName: string,
  deps: FolderWriteDeps
): Promise<Result<FolderEntity, AuxxError>> {
  return updateFolder(tx, ctx, folderId, { name: newName }, deps)
}

/**
 * Move a folder under a new parent, or to the root with `null`.
 *
 * A thin spelling of {@link updateFolder}. The legacy class had **both**
 * `move(id, parentId)` and `moveToParent(id, parentId)`, the former delegating
 * to the latter — the `InboxService` two-names-for-one-operation rot the lib
 * guide names. One survives.
 */
export async function moveFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string,
  newParentId: string | null,
  deps: FolderWriteDeps
): Promise<Result<FolderEntity, AuxxError>> {
  return updateFolder(tx, ctx, folderId, { parentId: normalizeParentId(newParentId) }, deps)
}

/**
 * Soft-delete a folder, its whole subtree, and every file in it.
 *
 * Two statements regardless of subtree size (the legacy was three, one of which
 * matched the wrong files — see the file header). Idempotent: rows already
 * carrying a `deletedAt` are left alone, so a second delete does not restamp the
 * timestamp and lose when the first delete happened.
 */
export async function deleteFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string,
  deps: FolderWriteDeps
): Promise<Result<void, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      await requireFolder(txCtx, folderId)
      const ids = await subtreeIds(txCtx, folderId)
      const now = deps.now()

      await tx
        .update(schema.Folder)
        .set({ deletedAt: now, updatedAt: now })
        .where(folderScope(txCtx, [inArray(schema.Folder.id, ids)]))

      await tx
        .update(schema.FolderFile)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.FolderFile.organizationId, txCtx.organizationId),
            inArray(schema.FolderFile.folderId, ids),
            isNull(schema.FolderFile.deletedAt)
          )
        )
    },
    'Failed to delete folder',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Undo {@link deleteFolder} for a folder and everything beneath it.
 *
 * Reads the hierarchy with `includeDeleted: true` — the subtree is by definition
 * soft-deleted, so an ordinary read returns an empty graph and would restore the
 * folder alone. Returns the folder unchanged when it was never deleted, which is
 * the legacy early return.
 *
 * This restores descendants that were deleted *before* their parent was, which
 * the path-prefix version also did. Recording per-row delete provenance is the
 * only way to do better and is out of scope for a refactor.
 */
export async function restoreFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string,
  deps: FolderWriteDeps
): Promise<Result<FolderEntity, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      const folder = await requireFolder(txCtx, folderId, { includeDeleted: true })
      if (!folder.deletedAt) return folder

      const ids = await subtreeIds(txCtx, folderId, { includeDeleted: true })
      const now = deps.now()

      const restored = await tx
        .update(schema.Folder)
        .set({ deletedAt: null, updatedAt: now })
        .where(
          folderScope(txCtx, [inArray(schema.Folder.id, ids), isNotNull(schema.Folder.deletedAt)], {
            includeDeleted: true,
          })
        )
        .returning()

      await tx
        .update(schema.FolderFile)
        .set({ deletedAt: null, updatedAt: now })
        .where(
          and(
            eq(schema.FolderFile.organizationId, txCtx.organizationId),
            inArray(schema.FolderFile.folderId, ids),
            isNotNull(schema.FolderFile.deletedAt)
          )
        )

      const self = (restored as FolderEntity[]).find((row) => row.id === folderId)
      if (!self) throw new NotFoundError(`Folder ${folderId} not found`)
      return self
    },
    'Failed to restore folder',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Hard-delete a folder, its subtree, and every file row in it.
 *
 * Files first, then folders: `Folder.parentId` is `NO ACTION`, but both
 * statements delete whole subtrees at once so the constraint is satisfied at
 * statement end.
 *
 * **This is the statement the missing organization filter mattered most on.**
 * The legacy body ran `tx.delete(Folder).where(eq(Folder.id, id))` with no scope
 * at all; anyone holding a folder id could erase another tenant's folder if the
 * pre-check were ever refactored away.
 *
 * Storage objects behind the deleted `FolderFile` rows are **not** collected
 * here — the legacy did not either, and orphan sweeping is `lifecycle/`'s job.
 */
export async function permanentlyDeleteFolder(
  tx: Transaction,
  ctx: FilesCtx,
  folderId: string
): Promise<Result<void, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      await requireFolder(txCtx, folderId, { includeDeleted: true })
      const ids = await subtreeIds(txCtx, folderId, { includeDeleted: true })

      await tx
        .delete(schema.FolderFile)
        .where(
          and(
            eq(schema.FolderFile.organizationId, txCtx.organizationId),
            inArray(schema.FolderFile.folderId, ids)
          )
        )

      await tx
        .delete(schema.Folder)
        .where(
          and(
            eq(schema.Folder.organizationId, txCtx.organizationId),
            inArray(schema.Folder.id, ids)
          )
        )
    },
    'Failed to permanently delete folder',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Copy a folder and everything under it to a new parent.
 *
 * Walks the source subtree breadth-first over an id map, so a folder is always
 * created after its parent and the recursion the legacy `copyFolderContents`
 * used — which re-queried the target folder on every level — is gone.
 *
 * File **versions** are copied through {@link FolderCopyDeps.files}, not by
 * constructing a `FileService` inside the loop. Storage objects are shared, not
 * duplicated, which is the behaviour `FileService.copyVersions` has always had.
 */
export async function copyFolder(
  tx: Transaction,
  ctx: FilesCtx,
  input: CopyFolderInput,
  deps: FolderCopyDeps
): Promise<Result<FolderEntity, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      const source = await requireFolder(txCtx, input.sourceId)
      const targetParentId = normalizeParentId(input.targetParentId)
      if (targetParentId) await requireFolder(txCtx, targetParentId)

      const name = input.newName ?? `Copy of ${source.name}`
      await assertNameAvailable(txCtx, name, targetParentId)

      const nodes = await loadFolderNodes(txCtx)
      if (targetParentId && wouldCreateCycle(indexById(nodes), input.sourceId, targetParentId)) {
        throw new ConflictError('Cannot copy a folder into its own subtree')
      }

      const root = await insertFolder(
        txCtx,
        { name, parentId: targetParentId, createdById: input.createdById ?? source.createdById },
        deps
      )

      // Breadth-first over the source subtree, so `idMap` always already holds
      // the copy of the current node's parent.
      const idMap = new Map<string, FolderEntity>([[source.id, root]])
      for (const node of descendantsOf(nodes, source.id)) {
        const parentCopy = node.parentId ? idMap.get(node.parentId) : undefined
        if (!parentCopy) continue
        idMap.set(
          node.id,
          await insertFolder(
            txCtx,
            { name: node.name, parentId: parentCopy.id, createdById: input.createdById },
            deps
          )
        )
      }

      await copyFilesInto(tx, txCtx, idMap, deps)
      return root
    },
    'Failed to copy folder',
    { sourceId: input.sourceId, organizationId: ctx.organizationId }
  )
}

/**
 * Move everything out of `sourceId` into `targetId`, then soft-delete the source.
 *
 * Refuses a merge into the source's own subtree with `ConflictError`. The legacy
 * `merge` had no such check and would happily re-parent the target's ancestors
 * under the target, producing exactly the cycle that then hung `getAncestors`.
 */
export async function mergeFolders(
  tx: Transaction,
  ctx: FilesCtx,
  sourceId: string,
  targetId: string,
  deps: FolderWriteDeps
): Promise<Result<void, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      if (sourceId === targetId) throw new BadRequestError('Cannot merge a folder with itself')

      await requireFolder(txCtx, sourceId)
      const target = await requireFolder(txCtx, targetId)

      const nodes = await loadFolderNodes(txCtx)
      const index = indexById(nodes)
      if (wouldCreateCycle(index, sourceId, targetId)) {
        throw new ConflictError('Cannot merge a folder into its own subtree')
      }

      const now = deps.now()
      const targetChain = [...ancestorsOf(index, targetId), index.get(targetId) as FolderNode]

      const files = await loadFilesIn(txCtx, [sourceId])
      for (const file of files) {
        await tx
          .update(schema.FolderFile)
          .set({
            folderId: targetId,
            path: joinPath(target.path, file.name),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.FolderFile.id, file.id),
              eq(schema.FolderFile.organizationId, txCtx.organizationId)
            )
          )
      }

      for (const child of nodes.filter((node) => node.parentId === sourceId)) {
        const path = computePath(targetChain, child.name)
        // `targetChain` is the target's ancestors *plus the target itself*, so
        // its length is already the moved child's new depth.
        const depth = targetChain.length
        await tx
          .update(schema.Folder)
          .set({ parentId: targetId, path, depth, updatedAt: now })
          .where(folderScope(txCtx, [eq(schema.Folder.id, child.id)]))
        await reshapeSubtree(tx, txCtx, nodes, { ...child, parentId: targetId }, path, depth, now)
      }

      await tx
        .update(schema.Folder)
        .set({ deletedAt: now, updatedAt: now })
        .where(folderScope(txCtx, [eq(schema.Folder.id, sourceId)]))
    },
    'Failed to merge folders',
    { sourceId, targetId, organizationId: ctx.organizationId }
  )
}

/**
 * Walk a `'a/b/c'` path, creating the folders that do not exist yet.
 *
 * Takes `ctx`, not a `Transaction`, matching the legacy `ensurePath` — the
 * creates are independent and a partially-created path is a valid state that a
 * repeat call completes. A caller that wants all-or-nothing passes
 * `{ ...ctx, db: tx }`.
 */
export async function ensureFolderPath(
  ctx: FilesCtx,
  path: string,
  deps: FolderWriteDeps,
  opts: { createdById?: string | null } = {}
): Promise<Result<FolderEntity, AuxxError>> {
  return guard(
    async () => {
      const parts = path.split('/').filter((part) => part.length > 0)
      if (parts.length === 0) throw new BadRequestError(`'${path}' names no folder`)

      let parentId: string | null = null
      let folder: FolderEntity | null = null

      for (const name of parts) {
        folder =
          (await findFolderByNameAndParent(ctx, name, parentId)) ??
          (await insertFolder(ctx, { name, parentId, createdById: opts.createdById }, deps))
        parentId = folder.id
      }

      if (!folder) throw new BadRequestError(`'${path}' names no folder`)
      return folder
    },
    'Failed to ensure folder path',
    { path, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * Refuse a name that is already taken under `parentId`.
 *
 * `excludeId` lets a folder keep its own name through a rename or a no-op move.
 * `ConflictError` (409), where every legacy path threw a bare `Error` and the
 * router turned it into a 400 with the message pasted in.
 */
export async function assertNameAvailable(
  ctx: FilesCtx,
  name: string,
  parentId: string | null,
  excludeId?: string
): Promise<void> {
  const existing = await findFolderByNameAndParent(ctx, name, parentId)
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(`A folder named '${name}' already exists here`)
  }
}

/** The shared body of every folder create. Validates, then a single `INSERT`. */
async function insertFolder(
  ctx: FilesCtx,
  input: CreateFolderInput,
  deps: FolderWriteDeps
): Promise<FolderEntity> {
  if (!isValidFolderName(input.name)) {
    throw new BadRequestError(`'${input.name}' is not a valid folder name`)
  }

  const parentId = normalizeParentId(input.parentId)
  const parent = parentId ? await requireFolder(ctx, parentId) : null
  await assertNameAvailable(ctx, input.name, parentId)

  const now = deps.now()
  const [created] = await ctx.db
    .insert(schema.Folder)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      parentId,
      path: joinPath(parent?.path, input.name),
      depth: parent ? parent.depth + 1 : 0,
      createdById: input.createdById ?? null,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!created) {
    throw new BadRequestError(
      `Failed to create folder '${input.name}': no row returned. Verify that parent '${parentId}' exists in organization '${ctx.organizationId}'.`
    )
  }
  return created as FolderEntity
}

/** `[folderId, ...descendants]`, from the `parentId` edges. Never empty. */
async function subtreeIds(
  ctx: FilesCtx,
  folderId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<string[]> {
  const nodes = await loadFolderNodes(ctx, opts)
  return [folderId, ...descendantsOf(nodes, folderId).map((node) => node.id)]
}

/**
 * Rewrite the `path`/`depth` of everything under `moved`, and the `path` of
 * their files.
 *
 * Takes the pre-move node list plus the moved node's *new* shape, recomputes
 * each descendant's position from the `parentId` edges, and writes only the rows
 * that actually changed. One `UPDATE` per changed folder and per changed file —
 * the same statement count the legacy had, minus the per-descendant `findMany`
 * it issued to fetch the files.
 */
async function reshapeSubtree(
  tx: Transaction,
  ctx: FilesCtx,
  nodes: readonly FolderNode[],
  moved: FolderNode,
  movedPath: string,
  movedDepth: number,
  now: Date
): Promise<void> {
  const positions = new Map<string, { path: string; depth: number }>([
    [moved.id, { path: movedPath, depth: movedDepth }],
  ])
  const byId = indexById(nodes)
  const descendants = descendantsOf(nodes, moved.id)

  for (const node of descendants) {
    const parent = node.parentId ? positions.get(node.parentId) : undefined
    // `descendantsOf` is breadth-first, so the parent's new position is already
    // known unless the graph is cyclic — in which case leave the row alone
    // rather than write a path derived from a partial walk.
    if (!parent) continue
    positions.set(node.id, {
      path: joinPath(parent.path, node.name),
      depth: parent.depth + 1,
    })
  }

  const changed: string[] = []
  for (const node of descendants) {
    const next = positions.get(node.id)
    const current = byId.get(node.id)
    if (!next || !current) continue
    if (current.path === next.path && current.depth === next.depth) continue
    changed.push(node.id)
    await tx
      .update(schema.Folder)
      .set({ path: next.path, depth: next.depth, updatedAt: now })
      .where(folderScope(ctx, [eq(schema.Folder.id, node.id)]))
  }

  // Files hang off `folderId`, so only the folders that actually moved need
  // their file paths rewritten — plus the moved folder itself.
  const folderIds = [moved.id, ...changed]
  for (const file of await loadFilesIn(ctx, folderIds)) {
    const owner = file.folderId ? positions.get(file.folderId) : undefined
    if (!owner) continue
    const path = joinPath(owner.path, file.name)
    if (path === file.path) continue
    await tx
      .update(schema.FolderFile)
      .set({ path, updatedAt: now })
      .where(
        and(
          eq(schema.FolderFile.id, file.id),
          eq(schema.FolderFile.organizationId, ctx.organizationId)
        )
      )
  }
}

/** Live files directly in each of `folderIds`. Returns `[]` for an empty list without querying. */
async function loadFilesIn(ctx: FilesCtx, folderIds: string[]): Promise<FolderFileEntity[]> {
  if (folderIds.length === 0) return []
  const rows = await ctx.db
    .select()
    .from(schema.FolderFile)
    .where(
      and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        inArray(schema.FolderFile.folderId, folderIds),
        isNull(schema.FolderFile.deletedAt)
      ) as SQL
    )
  return rows as FolderFileEntity[]
}

/** Duplicate every live file in the copied subtree into its counterpart folder. */
async function copyFilesInto(
  tx: Transaction,
  ctx: FilesCtx,
  idMap: ReadonlyMap<string, FolderEntity>,
  deps: FolderCopyDeps
): Promise<void> {
  const files = await loadFilesIn(ctx, [...idMap.keys()])
  const now = deps.now()

  for (const file of files) {
    const target = file.folderId ? idMap.get(file.folderId) : undefined
    if (!target) continue

    const [copy] = await tx
      .insert(schema.FolderFile)
      .values({
        organizationId: ctx.organizationId,
        folderId: target.id,
        name: file.name,
        path: joinPath(target.path, file.name),
        ext: file.ext,
        mimeType: file.mimeType,
        size: file.size,
        createdById: file.createdById,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!copy) throw new BadRequestError(`Failed to copy file '${file.name}'`)
    await deps.files.copyFileVersions(file.id, (copy as FolderFileEntity).id)
  }
}
