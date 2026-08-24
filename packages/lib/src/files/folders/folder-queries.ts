// packages/lib/src/files/folders/folder-queries.ts

/**
 * `Folder` reads.
 *
 * Writes live in `folders/folder-mutations.ts`, the graph algorithms in
 * `folders/tree.ts` — `docs/lib-module-guide.md` §5. `core/folder-service.ts`
 * mixed all three and reached 1,945 lines across 45 methods, 23 of which
 * anything called.
 *
 * ## Organization scope is unconditional
 *
 * `BaseService.buildBaseWhereClause` added `eq(organizationId, …)` **only when
 * the service happened to have been constructed with one** and returned
 * `undefined` — no `WHERE` at all — otherwise. `Folder.organizationId` is
 * `NOT NULL`, so there is no pre-backfill population to keep visible and the
 * conditional bought nothing except a cross-tenant read whenever a construction
 * site forgot its first argument. `FilesCtx.organizationId` is required, so that
 * branch cannot be expressed here.
 *
 * ## The hierarchy is loaded once and walked in memory
 *
 * {@link loadFolderNodes} issues one narrow `SELECT` for an organization's whole
 * folder graph and everything hierarchical is then a pure function over it
 * (`tree.ts`). This replaces three different legacy strategies that disagreed
 * with each other:
 *
 * - `getAncestors` walked upward one point query at a time, with no visited set
 *   — unbounded on cyclic data.
 * - `getDescendants`, the delete cascade and the deep counts matched
 *   `path LIKE '<path>%'`, which is wrong whenever `path` has drifted (the
 *   condition `rebuildPaths` exists to repair) and wrong again for any name
 *   containing `%` or `_`.
 * - `getFolderTree` eagerly loaded the `files` **and** `children` relations of
 *   every folder in the organization to compute a `fileCount` it then read off
 *   a Prisma `_count` field Drizzle does not produce, so the number was always
 *   zero.
 *
 * Walking `parentId` costs one query and is correct against all three. The
 * trade is that the whole folder list is materialised; a folder tree is a
 * navigation aid measured in hundreds of rows per organization, and the
 * projection is five columns wide.
 */

import { schema } from '@auxx/database'
import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  type SQL,
  sql,
  sum,
} from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'
import type { FolderAggregate, FolderNode, FolderTreeNode } from './tree'
import { ancestorsOf, buildFolderTree, descendantsOf, indexById, isValidFolderName } from './tree'

// ============= Result shapes =============

/** A folder plus the relations the detail view renders. */
export interface FolderDetail extends FolderEntity {
  parent: FolderEntity | null
  children: FolderEntity[]
  /** Capped at {@link DETAIL_FILE_LIMIT}, as the legacy `getWithRelations` was. */
  files: FolderFileEntity[]
  createdBy: { id: string; name: string | null; email: string | null } | null
}

/** One page of folders plus the total the page was cut from. */
export interface FolderPage {
  items: FolderEntity[]
  total: number
  hasMore: boolean
}

/** A folder matched by {@link searchFolders}, with its relevance score. */
export interface FolderSearchHit {
  folder: FolderEntity
  relevance: number
  matchedFields: string[]
  snippet: string
}

/**
 * The four numbers `folderRouter.getStats` renders, from two queries.
 *
 * The legacy shape was four separate methods, each of which re-read the folder
 * row and then ran its own aggregate — eight statements for one panel. `sizes`
 * and both counts come from a single grouped aggregate over the subtree, and
 * `subfolderCount` is free because the hierarchy is already in memory.
 */
export interface FolderCounts {
  /** Bytes in this folder and every folder beneath it. */
  totalSize: number
  /** Live files in this folder and every folder beneath it. */
  deepFileCount: number
  /** Live files directly in this folder. */
  directFileCount: number
  /** Immediate live subfolders. */
  subfolderCount: number
}

/** What `folderRouter.getUsage` renders. */
export interface FolderUsage {
  fileCount: number
  totalSize: number
  lastActivity: Date | null
  mostActiveSubfolder: { id: string; name: string } | null
}

/** Options for {@link listFolders}. */
export interface ListFoldersOptions {
  limit?: number
  offset?: number
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'path' | 'depth'
  sortOrder?: 'asc' | 'desc'
  parentId?: string | null
  includeDeleted?: boolean
}

/** Options for {@link searchFolders}. */
export interface SearchFoldersOptions {
  limit?: number
  offset?: number
  createdAfter?: Date
  createdBefore?: Date
}

/** How many files `getFolderWithRelations` attaches before truncating. */
export const DETAIL_FILE_LIMIT = 50

/** Default page size for {@link listFolders}, matching the legacy `list()`. */
export const DEFAULT_LIST_LIMIT = 50

// ============= Reads =============

/**
 * Load one folder, scoped to the caller's organization.
 *
 * Returns `ok(null)` when the row does not exist, is soft-deleted, or belongs to
 * another organization — the three collapse into one answer so a caller cannot
 * probe for ids outside its tenant.
 */
export async function getFolder(
  ctx: FilesCtx,
  folderId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<Result<FolderEntity | null, AuxxError>> {
  return guard(async () => findFolder(ctx, folderId, opts), 'Failed to get folder', {
    folderId,
    organizationId: ctx.organizationId,
  })
}

/**
 * Load one folder with its parent, immediate children, first
 * {@link DETAIL_FILE_LIMIT} files and creator.
 *
 * Four explicit statements rather than one relational `findFirst({ with })`,
 * because the relational form is what let `getFolderTree` load every file row in
 * the organization by accident — an explicit projection makes the cost of each
 * relation visible in the diff. Every one of the four is organization-scoped;
 * the legacy `with:` sub-queries filtered only `deletedAt`.
 */
export async function getFolderWithRelations(
  ctx: FilesCtx,
  folderId: string
): Promise<Result<FolderDetail | null, AuxxError>> {
  return guard(
    async () => {
      const folder = await findFolder(ctx, folderId)
      if (!folder) return null

      const [parent, children, files, createdBy] = await Promise.all([
        folder.parentId ? findFolder(ctx, folder.parentId) : Promise.resolve(null),
        loadChildren(ctx, folderId),
        loadDirectFiles(ctx, folderId),
        folder.createdById ? loadCreator(ctx, folder.createdById) : Promise.resolve(null),
      ])

      return { ...folder, parent, children, files, createdBy }
    },
    'Failed to get folder with relations',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * One page of folders, newest-conventions ordering (`name` ascending) by default.
 *
 * The legacy `list()` accepted a free-form `filters: Record<string, any>` object
 * that was translated by indexing `(schema.Folder as any)[key]` — eighty lines
 * that let a caller filter on any column, or on none, with no type at all. Its
 * only caller passes no arguments. The one filter worth keeping is `parentId`,
 * which is declared here.
 */
export async function listFolders(
  ctx: FilesCtx,
  options: ListFoldersOptions = {}
): Promise<Result<FolderPage, AuxxError>> {
  return guard(
    async () => {
      const {
        limit = DEFAULT_LIST_LIMIT,
        offset = 0,
        sortBy = 'name',
        sortOrder = 'asc',
        includeDeleted = false,
      } = options

      const conditions: SQL[] = []
      if (options.parentId !== undefined) {
        conditions.push(
          options.parentId === null
            ? isNull(schema.Folder.parentId)
            : eq(schema.Folder.parentId, options.parentId)
        )
      }
      const where = folderScope(ctx, conditions, { includeDeleted })

      const column = {
        name: schema.Folder.name,
        createdAt: schema.Folder.createdAt,
        updatedAt: schema.Folder.updatedAt,
        path: schema.Folder.path,
        depth: schema.Folder.depth,
      }[sortBy]

      const [items, totals] = await Promise.all([
        ctx.db
          .select()
          .from(schema.Folder)
          .where(where)
          .orderBy(sortOrder === 'asc' ? asc(column) : desc(column))
          .offset(offset)
          .limit(limit),
        ctx.db.select({ value: count() }).from(schema.Folder).where(where),
      ])

      const total = Number(totals[0]?.value ?? 0)
      return {
        items: items as FolderEntity[],
        total,
        hasMore: offset + items.length < total,
      }
    },
    'Failed to list folders',
    { organizationId: ctx.organizationId }
  )
}

/**
 * The organization's whole folder hierarchy as a nested tree, with real
 * per-folder file counts and sizes.
 *
 * Two statements: the node projection and one grouped aggregate over
 * `FolderFile`. See the file header for what this replaces.
 */
export async function getFolderTree(ctx: FilesCtx): Promise<Result<FolderTreeNode[], AuxxError>> {
  return guard(
    async () => {
      const [nodes, aggregates] = await Promise.all([loadFolderNodes(ctx), loadFileAggregates(ctx)])
      return buildFolderTree(nodes, aggregates)
    },
    'Failed to build folder tree',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Immediate live subfolders of `parentId`, or the roots when it is `null`.
 *
 * The legacy signature typed `parentId: string | null` but its router passed
 * `input.folderId`, a required string, so the root case was unreachable through
 * tRPC. It is kept because the shape is right, not because anything uses it yet.
 */
export async function getSubfolders(
  ctx: FilesCtx,
  parentId: string | null
): Promise<Result<FolderEntity[], AuxxError>> {
  return guard(
    async () => {
      const rows = await ctx.db
        .select()
        .from(schema.Folder)
        .where(
          folderScope(ctx, [
            parentId === null
              ? isNull(schema.Folder.parentId)
              : eq(schema.Folder.parentId, parentId),
          ])
        )
        .orderBy(asc(schema.Folder.name))
      return rows as FolderEntity[]
    },
    'Failed to get subfolders',
    { parentId, organizationId: ctx.organizationId }
  )
}

/**
 * The chain of parents from the root down to `folderId`'s immediate parent.
 *
 * Two statements — the node projection, then the full rows for the chain — and
 * it terminates on cyclic data. The legacy version issued one query per level
 * with no visited set; see `tree.ts`'s header.
 *
 * `err(NotFoundError)` when the folder itself is not visible to the caller,
 * where the legacy returned an empty array and made "no ancestors" and "no such
 * folder" indistinguishable.
 */
export async function getFolderAncestors(
  ctx: FilesCtx,
  folderId: string
): Promise<Result<FolderEntity[], AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      const index = indexById(nodes)
      if (!index.has(folderId)) throw new NotFoundError(`Folder ${folderId} not found`)

      const chain = ancestorsOf(index, folderId)
      return orderRowsBy(
        await loadFoldersByIds(
          ctx,
          chain.map((node) => node.id)
        ),
        chain
      )
    },
    'Failed to get folder ancestors',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Every folder beneath `folderId`, breadth-first.
 *
 * Ordered by the graph walk rather than by `path`, which is the ordering the
 * legacy `ORDER BY path` was approximating with a column that can be stale.
 */
export async function getFolderDescendants(
  ctx: FilesCtx,
  folderId: string
): Promise<Result<FolderEntity[], AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      if (!indexById(nodes).has(folderId)) {
        throw new NotFoundError(`Folder ${folderId} not found`)
      }

      const subtree = descendantsOf(nodes, folderId)
      return orderRowsBy(
        await loadFoldersByIds(
          ctx,
          subtree.map((node) => node.id)
        ),
        subtree
      )
    },
    'Failed to get folder descendants',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Name- and path-matched folders, scored for relevance.
 *
 * Scoring is carried over unchanged from `FolderService.search` (exact name 10,
 * name contains 5, path contains 3, floor of 1) so the result ordering the UI
 * shows does not move under a refactor. What did change: the query no longer
 * eagerly loads each hit's `files` and `children` relations, which it fetched
 * and then discarded.
 */
export async function searchFolders(
  ctx: FilesCtx,
  query: string,
  options: SearchFoldersOptions = {}
): Promise<Result<FolderSearchHit[], AuxxError>> {
  return guard(
    async () => {
      const conditions: SQL[] = [
        sql`(
          LOWER(${schema.Folder.name}) = LOWER(${query}) OR
          LOWER(${schema.Folder.name}) LIKE LOWER(${`%${query}%`}) OR
          LOWER(${schema.Folder.path}) LIKE LOWER(${`%${query}%`})
        )`,
      ]
      if (options.createdAfter) conditions.push(gte(schema.Folder.createdAt, options.createdAfter))
      if (options.createdBefore) {
        conditions.push(lte(schema.Folder.createdAt, options.createdBefore))
      }

      const rows = await ctx.db
        .select()
        .from(schema.Folder)
        .where(folderScope(ctx, conditions))
        .orderBy(desc(schema.Folder.updatedAt))
        .offset(options.offset ?? 0)
        .limit(options.limit ?? DEFAULT_LIST_LIMIT)

      const needle = query.toLowerCase()
      return (rows as FolderEntity[])
        .map((folder) => scoreFolder(folder, needle))
        .sort((a, b) => b.relevance - a.relevance)
    },
    'Failed to search folders',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Size and file/subfolder counts for one folder and its subtree.
 *
 * Membership is `folderId IN (subtree)`, not `path LIKE '<path>%'`. That is a
 * deliberate behaviour fix: the legacy predicate used the folder's path
 * **without a trailing slash** for `FolderFile`, so a folder named `Doc`
 * counted — and, on the delete path, cascaded into — everything under
 * `Documents`. `folderId` is a real foreign key and cannot drift.
 */
export async function getFolderCounts(
  ctx: FilesCtx,
  folderId: string
): Promise<Result<FolderCounts, AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      if (!indexById(nodes).has(folderId)) {
        throw new NotFoundError(`Folder ${folderId} not found`)
      }

      const subtree = descendantsOf(nodes, folderId)
      const aggregates = await loadFileAggregates(ctx, [folderId, ...subtree.map((n) => n.id)])

      let totalSize = 0
      let deepFileCount = 0
      for (const aggregate of aggregates.values()) {
        totalSize += aggregate.totalSize
        deepFileCount += aggregate.fileCount
      }

      return {
        totalSize,
        deepFileCount,
        directFileCount: aggregates.get(folderId)?.fileCount ?? 0,
        subfolderCount: nodes.filter((node) => node.parentId === folderId).length,
      }
    },
    'Failed to get folder counts',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Activity summary for one folder.
 *
 * `mostActiveSubfolder` is now the immediate subfolder holding the most recently
 * touched file. The legacy body claimed the same thing but ordered by
 * `folders.name` descending with a comment conceding it ("Simplified ordering
 * since file count ordering is complex in Drizzle"), so it reported whichever
 * subfolder sorted last alphabetically — a stable answer that was almost never
 * the right one.
 */
export async function getFolderUsage(
  ctx: FilesCtx,
  folderId: string
): Promise<Result<FolderUsage, AuxxError>> {
  return guard(
    async () => {
      const nodes = await loadFolderNodes(ctx)
      const index = indexById(nodes)
      if (!index.has(folderId)) throw new NotFoundError(`Folder ${folderId} not found`)

      const subtree = descendantsOf(nodes, folderId)
      const subtreeIds = [folderId, ...subtree.map((node) => node.id)]

      const [aggregates, latest, active] = await Promise.all([
        loadFileAggregates(ctx, subtreeIds),
        ctx.db
          .select({ updatedAt: schema.FolderFile.updatedAt })
          .from(schema.FolderFile)
          .where(liveFilesIn(ctx, subtreeIds))
          .orderBy(desc(schema.FolderFile.updatedAt))
          .limit(1),
        ctx.db
          .select({
            folderId: schema.FolderFile.folderId,
            lastActivity: sql<Date>`max(${schema.FolderFile.updatedAt})`,
          })
          .from(schema.FolderFile)
          .where(liveFilesIn(ctx, subtreeIds))
          .groupBy(schema.FolderFile.folderId)
          .orderBy(desc(sql`max(${schema.FolderFile.updatedAt})`)),
      ])

      let totalSize = 0
      let fileCount = 0
      for (const aggregate of aggregates.values()) {
        totalSize += aggregate.totalSize
        fileCount += aggregate.fileCount
      }

      // Walk the ranked list until one entry resolves to a *direct* child of the
      // folder, so activity deep in the subtree is credited to the branch it
      // belongs to rather than being dropped.
      let mostActiveSubfolder: { id: string; name: string } | null = null
      for (const row of active) {
        if (!row.folderId) continue
        const branch = branchUnder(index, row.folderId, folderId)
        if (!branch) continue
        mostActiveSubfolder = { id: branch.id, name: branch.name }
        break
      }

      return {
        fileCount,
        totalSize,
        lastActivity: latest[0]?.updatedAt ?? null,
        mostActiveSubfolder,
      }
    },
    'Failed to get folder usage',
    { folderId, organizationId: ctx.organizationId }
  )
}

/**
 * Whether `name` is both structurally valid and free under `parentId`.
 *
 * `excludeId` lets a rename keep its own name. Mirrors the legacy
 * `validateName`, which returned a bare boolean and swallowed the distinction
 * between "illegal characters" and "already taken"; the mutations call
 * {@link assertNameAvailable} instead, which reports which of the two it was.
 */
export async function isFolderNameAvailable(
  ctx: FilesCtx,
  name: string,
  parentId: string | null,
  excludeId?: string
): Promise<Result<boolean, AuxxError>> {
  return guard(
    async () => {
      if (!isValidFolderName(name)) return false
      const existing = await findFolderByNameAndParent(ctx, name, parentId)
      return !existing || existing.id === excludeId
    },
    'Failed to validate folder name',
    { name, parentId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The organization-scope predicate every folder statement carries.
 *
 * Exported because `folder-mutations.ts` and `maintenance.ts` must apply the
 * identical filter — including on `UPDATE` and `DELETE`, which the legacy code
 * did not (see `folder-mutations.ts`).
 */
export function folderScope(
  ctx: FilesCtx,
  conditions: SQL[] = [],
  opts: { includeDeleted?: boolean } = {}
): SQL {
  const all: SQL[] = [eq(schema.Folder.organizationId, ctx.organizationId), ...conditions]
  if (!opts.includeDeleted) all.push(isNull(schema.Folder.deletedAt))
  return and(...all) as SQL
}

/** The `FolderFile` counterpart of {@link folderScope}, restricted to a folder id set. */
export function liveFilesIn(ctx: FilesCtx, folderIds: string[]): SQL {
  return and(
    eq(schema.FolderFile.organizationId, ctx.organizationId),
    inArray(schema.FolderFile.folderId, folderIds),
    isNull(schema.FolderFile.deletedAt)
  ) as SQL
}

/** {@link getFolder}'s body, without the `Result` wrapper. */
export async function findFolder(
  ctx: FilesCtx,
  folderId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<FolderEntity | null> {
  const [row] = await ctx.db
    .select()
    .from(schema.Folder)
    .where(folderScope(ctx, [eq(schema.Folder.id, folderId)], opts))
    .limit(1)
  return (row as FolderEntity | undefined) ?? null
}

/**
 * Load a folder or throw `NotFoundError`.
 *
 * The existence check every mutation runs first. It throws rather than returning
 * `err()` so a failure inside a caller's transaction rolls that transaction
 * back.
 */
export async function requireFolder(
  ctx: FilesCtx,
  folderId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<FolderEntity> {
  const folder = await findFolder(ctx, folderId, opts)
  if (!folder) throw new NotFoundError(`Folder ${folderId} not found`)
  return folder
}

/**
 * One narrow `SELECT` for an organization's whole folder graph.
 *
 * Five columns, which is everything `tree.ts` needs. Pass
 * `includeDeleted: true` on the restore and permanent-delete paths, where the
 * subtree being operated on is by definition soft-deleted and an ordinary read
 * would return an empty graph.
 */
export async function loadFolderNodes(
  ctx: FilesCtx,
  opts: { includeDeleted?: boolean } = {}
): Promise<FolderNode[]> {
  const rows = await ctx.db
    .select({
      id: schema.Folder.id,
      parentId: schema.Folder.parentId,
      name: schema.Folder.name,
      path: schema.Folder.path,
      depth: schema.Folder.depth,
    })
    .from(schema.Folder)
    .where(folderScope(ctx, [], opts))
    .orderBy(asc(schema.Folder.depth), asc(schema.Folder.name))
  return rows as FolderNode[]
}

/**
 * Live file count and byte total per folder id.
 *
 * Omit `folderIds` for the whole organization (the tree read); pass a subtree
 * for a scoped total. A folder with no live files is absent from the map, which
 * callers read as zero.
 */
export async function loadFileAggregates(
  ctx: FilesCtx,
  folderIds?: string[]
): Promise<Map<string, FolderAggregate>> {
  if (folderIds && folderIds.length === 0) return new Map()

  const where = folderIds
    ? liveFilesIn(ctx, folderIds)
    : (and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        isNull(schema.FolderFile.deletedAt)
      ) as SQL)

  const rows = await ctx.db
    .select({
      folderId: schema.FolderFile.folderId,
      fileCount: count(schema.FolderFile.id),
      totalSize: sum(schema.FolderFile.size),
    })
    .from(schema.FolderFile)
    .where(where)
    .groupBy(schema.FolderFile.folderId)

  const aggregates = new Map<string, FolderAggregate>()
  for (const row of rows) {
    // `folderId` is nullable — a `FolderFile` at the library root has none — and
    // those rows belong to no folder's total.
    if (!row.folderId) continue
    aggregates.set(row.folderId, {
      fileCount: Number(row.fileCount ?? 0),
      totalSize: Number(row.totalSize ?? 0),
    })
  }
  return aggregates
}

/**
 * The folder with `name` directly under `parentId`, or `null`.
 *
 * Backs the uniqueness half of every create, rename and move.
 * `Folder_organizationId_parentId_name_key` is the unique index this mirrors, so
 * a race that beats the check still fails at the database rather than writing a
 * duplicate.
 */
export async function findFolderByNameAndParent(
  ctx: FilesCtx,
  name: string,
  parentId: string | null | undefined
): Promise<FolderEntity | null> {
  const [row] = await ctx.db
    .select()
    .from(schema.Folder)
    .where(
      folderScope(ctx, [
        eq(schema.Folder.name, name),
        parentId ? eq(schema.Folder.parentId, parentId) : isNull(schema.Folder.parentId),
      ])
    )
    .limit(1)
  return (row as FolderEntity | undefined) ?? null
}

/** Full folder rows for an id list, unordered. Returns `[]` for an empty list without querying. */
export async function loadFoldersByIds(
  ctx: FilesCtx,
  folderIds: string[]
): Promise<FolderEntity[]> {
  if (folderIds.length === 0) return []
  const rows = await ctx.db
    .select()
    .from(schema.Folder)
    .where(folderScope(ctx, [inArray(schema.Folder.id, folderIds)]))
  return rows as FolderEntity[]
}

/** Reorder loaded rows to match the graph walk that produced the id list. */
function orderRowsBy(rows: FolderEntity[], order: readonly FolderNode[]): FolderEntity[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ordered: FolderEntity[] = []
  for (const node of order) {
    const row = byId.get(node.id)
    if (row) ordered.push(row)
  }
  return ordered
}

/** The direct child of `rootId` that `folderId` sits under, or `null`. */
function branchUnder(
  index: ReadonlyMap<string, FolderNode>,
  folderId: string,
  rootId: string
): FolderNode | null {
  const seen = new Set<string>()
  let cursor = index.get(folderId) ?? null
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    if (cursor.parentId === rootId) return cursor
    cursor = cursor.parentId ? (index.get(cursor.parentId) ?? null) : null
  }
  return null
}

/** {@link searchFolders}'s relevance rule, kept together with its snippet. */
function scoreFolder(folder: FolderEntity, needle: string): FolderSearchHit {
  let relevance = 0
  const matchedFields: string[] = []
  const name = folder.name.toLowerCase()
  const path = folder.path?.toLowerCase() ?? ''

  if (name === needle) {
    relevance += 10
    matchedFields.push('name')
  } else if (name.includes(needle)) {
    relevance += 5
    matchedFields.push('name')
  }
  if (path.includes(needle)) {
    relevance += 3
    if (!matchedFields.includes('path')) matchedFields.push('path')
  }

  const parts: string[] = []
  if (name.includes(needle)) parts.push(`Name: ${folder.name}`)
  if (path.includes(needle)) parts.push(`Path: ${folder.path}`)

  return {
    folder,
    relevance: Math.max(relevance, 1),
    matchedFields,
    snippet: parts.join(' | ') || folder.name,
  }
}

/** Immediate live subfolders, name-ordered. Its own function so the four
 * relation loads in {@link getFolderWithRelations} issue their statements in
 * declaration order rather than in microtask-scheduling order. */
async function loadChildren(ctx: FilesCtx, folderId: string): Promise<FolderEntity[]> {
  const rows = await ctx.db
    .select()
    .from(schema.Folder)
    .where(folderScope(ctx, [eq(schema.Folder.parentId, folderId)]))
    .orderBy(asc(schema.Folder.name))
  return rows as FolderEntity[]
}

/** The first {@link DETAIL_FILE_LIMIT} live files directly in a folder. */
async function loadDirectFiles(ctx: FilesCtx, folderId: string): Promise<FolderFileEntity[]> {
  const rows = await ctx.db
    .select()
    .from(schema.FolderFile)
    .where(
      and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        eq(schema.FolderFile.folderId, folderId),
        isNull(schema.FolderFile.deletedAt)
      )
    )
    .orderBy(asc(schema.FolderFile.name))
    .limit(DETAIL_FILE_LIMIT)
  return rows as FolderFileEntity[]
}

async function loadCreator(ctx: FilesCtx, userId: string): Promise<FolderDetail['createdBy']> {
  const [row] = await ctx.db
    .select({ id: schema.User.id, name: schema.User.name, email: schema.User.email })
    .from(schema.User)
    .where(eq(schema.User.id, userId))
    .limit(1)
  return row ?? null
}
