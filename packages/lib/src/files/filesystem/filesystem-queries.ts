// packages/lib/src/files/filesystem/filesystem-queries.ts

/**
 * The two filesystem reads: the whole library in one page, and the move plan.
 *
 * Writes live in `filesystem-mutations.ts`, the decision logic in
 * `move-plan.ts`, the shaping in `items.ts` — `docs/lib-module-guide.md` §5.
 *
 * ## What this file removes
 *
 * `FilesystemService.getCompleteFileSystem` issued **`3 + 2N` statements**,
 * where `N` is the number of folders in the organization: one page of files, one
 * list of folders, one total count, and then — inside
 * `Promise.all(folders.map(...))` — a `COUNT(*)` of the folder's files and a
 * `COUNT(*)` of its subfolders, per folder. A 300-folder library cost 603
 * round-trips to render a sidebar. It is four statements now: the page, the
 * folders, one `GROUP BY` for the file counts, and the total. Subfolder counts
 * are computed from the `parentId` edges already in memory.
 *
 * With `lastSync` it was `9 + 2N`, because `getChangesSince` fired six more
 * `SELECT`s. **No caller has ever passed `lastSync`** — the incremental-sync
 * protocol was written, shipped and never spoken — so the option, the six
 * queries and the `changes` / `lastUpdated` response fields are deleted rather
 * than ported.
 *
 * ## Two scope holes closed
 *
 * Both per-folder count queries were written as
 * `where(eq(FolderFile.folderId, folder.id), isNull(deletedAt))` and
 * `where(eq(Folder.parentId, folder.id), isNull(deletedAt))` — **no
 * organization filter on either**. Each was preceded by an org-scoped read of
 * the folder, so neither was exploitable on its own, but it is the shape PR 5b
 * found already broken on `detachFromEntity`. The counts now come from
 * `loadFileAggregates`, which scopes unconditionally, and from an in-memory
 * walk of a list that was itself loaded org-scoped.
 *
 * `getTotalFilesCount` also disagreed with the page it was counting:
 * `buildFileWhereClause` carried a comment saying the `fileTypes` filter would
 * be "handled in the query directly" and then never applied it, so `totalFiles`
 * reported the unfiltered count whenever a type filter was on. One predicate
 * builds both statements here.
 */

import { schema } from '@auxx/database'
import { and, asc, count, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { loadFileAggregates, loadFolderNodes } from '../folders/folder-queries'
import type { FolderNode } from '../folders/tree'
import { indexById, indexByParent, normalizeParentId } from '../folders/tree'
import { guard } from '../guard'
import type { FileItem, FilesystemFileRow, FilesystemFolderRow } from './items'
import { decodeFileCursor, encodeFileCursor, fileItemFromFolderRow, fileItemFromRow } from './items'
import type { MoveCollisionPolicy, MoveFileRow, MoveItemRef, MovePlanEntry } from './move-plan'
import { buildMovePlan } from './move-plan'

/** How many files one page carries when the caller does not say. */
export const DEFAULT_FILES_LIMIT = 500

/** Filtering and pagination for {@link getCompleteFileSystem}. */
export interface GetFileSystemOptions {
  /** Opaque keyset cursor from a previous page's `filesNextCursor`. */
  filesCursor?: string
  filesLimit?: number
  /** Extensions, with or without a leading dot. Applied to both the page and the total. */
  fileTypes?: string[]
  /** Include archived **files**. Folders are always filtered to live, unarchived rows. */
  includeArchived?: boolean
}

/**
 * One page of files plus **every** folder.
 *
 * Folders are deliberately not paginated: the sidebar needs the whole tree to
 * render a path, and the tree is orders of magnitude smaller than the file list.
 */
export interface FileSystemResult {
  items: FileItem[]
  filesHasNextPage: boolean
  filesNextCursor: string | null
  totalFiles: number
  totalFolders: number
}

/** What {@link planMoveItems} needs to decide a bulk move. */
export interface PlanMoveItemsInput {
  items: readonly MoveItemRef[]
  /** `null` and the UI's `'root'` sentinel both mean the library root. */
  targetFolderId: string | null
  /** Defaults to `'rename'`. */
  collision?: MoveCollisionPolicy
}

/**
 * Load one page of files and the complete folder tree, shaped for the UI.
 *
 * Four statements, regardless of how many folders the organization has. See the
 * file header for what that replaces.
 *
 * @param ctx Scope and database.
 * @param options Pagination and filtering. All fields optional.
 */
export async function getCompleteFileSystem(
  ctx: FilesCtx,
  options: GetFileSystemOptions = {}
): Promise<Result<FileSystemResult, AuxxError>> {
  return guard(
    async () => {
      const limit = options.filesLimit ?? DEFAULT_FILES_LIMIT
      const filter = fileFilter(ctx, options)
      const cursor = options.filesCursor ? decodeFileCursor(options.filesCursor) : null

      // The +1 row is how `hasNextPage` is detected without a second count.
      const [fileRows, folderRows, aggregates, totals] = await Promise.all([
        selectFilePage(ctx, filter, cursor, limit + 1),
        selectFolders(ctx),
        loadFileAggregates(ctx),
        ctx.db.select({ total: count() }).from(schema.FolderFile).where(filter),
      ])

      const hasNextPage = fileRows.length > limit
      const page = hasNextPage ? fileRows.slice(0, limit) : fileRows
      const last = hasNextPage ? page[page.length - 1] : undefined

      const index = indexById(folderRows as FolderNode[])
      const byParent = indexByParent(folderRows as FolderNode[])

      const items: FileItem[] = [
        ...page.map((row) => fileItemFromRow(row, index)),
        ...folderRows.map((row) =>
          fileItemFromFolderRow(
            row,
            {
              fileCount: aggregates.get(row.id)?.fileCount ?? 0,
              subfolderCount: byParent.get(row.id)?.length ?? 0,
            },
            index
          )
        ),
      ]

      return {
        items,
        filesHasNextPage: hasNextPage,
        filesNextCursor: last
          ? encodeFileCursor({ path: last.path ?? '', name: last.name, id: last.id })
          : null,
        totalFiles: Number(totals[0]?.total ?? 0),
        totalFolders: folderRows.length,
      }
    },
    'Failed to load the filesystem',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Decide what a bulk move should do, without writing anything.
 *
 * Three statements — the folder graph, the selected files, the names already in
 * the target — feeding the pure {@link buildMovePlan}. The legacy planner issued
 * one query per collision check, one per rename candidate and one per ancestor
 * level of every folder being moved.
 *
 * Exported separately from execution on purpose: "show me what this move would
 * do" is then a call, not a `dryRun: true` flag threaded through a function that
 * also writes. The legacy flag is deleted; no caller ever set it.
 *
 * @throws {NotFoundError} when `targetFolderId` names no live folder in this organization.
 */
export async function planMoveItems(
  ctx: FilesCtx,
  input: PlanMoveItemsInput
): Promise<Result<MovePlanEntry[], AuxxError>> {
  return guard(
    async () => {
      const target = normalizeParentId(input.targetFolderId)
      const folders = await loadFolderNodes(ctx)

      // `loadFolderNodes` is organization-scoped and live-only, so membership in
      // it IS the target's existence check — the legacy spent a separate query
      // on it and then threw a bare `Error`, which `fileRouter` flattened to 400.
      if (target && !indexById(folders).has(target)) {
        throw new NotFoundError(`Target folder ${target} not found`)
      }

      const fileIds = input.items.filter((item) => item.type === 'file').map((item) => item.id)
      const [files, targetFileNames] = await Promise.all([
        selectMoveFiles(ctx, fileIds),
        selectFileNamesIn(ctx, target),
      ])

      return buildMovePlan(
        input.items,
        target,
        { files, folders, targetFileNames },
        { collision: input.collision }
      )
    },
    'Failed to plan the move',
    { targetFolderId: input.targetFolderId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * The predicate shared by the file page and the file total.
 *
 * Sharing it is the fix for the two disagreeing: the legacy built the page's
 * conditions inline and the total's in `buildFileWhereClause`, which silently
 * dropped `fileTypes`.
 */
function fileFilter(ctx: FilesCtx, options: GetFileSystemOptions): SQL {
  const conditions: SQL[] = [
    eq(schema.FolderFile.organizationId, ctx.organizationId),
    isNull(schema.FolderFile.deletedAt),
  ]

  if (!options.includeArchived) {
    conditions.push(eq(schema.FolderFile.isArchived, false))
  }

  if (options.fileTypes?.length) {
    const byExt = options.fileTypes.map((ext) =>
      eq(schema.FolderFile.ext, ext.toLowerCase().replace(/^\./, ''))
    )
    const clause = or(...byExt)
    if (clause) conditions.push(clause)
  }

  return and(...conditions) as SQL
}

/**
 * One page of files in `(path, name, id)` order, joined to their folder.
 *
 * The row-value comparison matches the `ORDER BY` exactly, which is what makes
 * the cursor a keyset rather than an offset. The join supplies `folderName` /
 * `folderPath` for rows whose folder is archived — see {@link FilesystemFileRow}.
 */
async function selectFilePage(
  ctx: FilesCtx,
  filter: SQL,
  cursor: { path: string; name: string; id: string } | null,
  limit: number
): Promise<FilesystemFileRow[]> {
  const where = cursor
    ? (and(
        filter,
        sql`(${schema.FolderFile.path}, ${schema.FolderFile.name}, ${schema.FolderFile.id}) > (${cursor.path}, ${cursor.name}, ${cursor.id})`
      ) as SQL)
    : filter

  const rows = await ctx.db
    .select({
      id: schema.FolderFile.id,
      name: schema.FolderFile.name,
      size: schema.FolderFile.size,
      mimeType: schema.FolderFile.mimeType,
      ext: schema.FolderFile.ext,
      createdAt: schema.FolderFile.createdAt,
      updatedAt: schema.FolderFile.updatedAt,
      path: schema.FolderFile.path,
      folderId: schema.FolderFile.folderId,
      isArchived: schema.FolderFile.isArchived,
      organizationId: schema.FolderFile.organizationId,
      createdById: schema.FolderFile.createdById,
      currentVersionId: schema.FolderFile.currentVersionId,
      deletedAt: schema.FolderFile.deletedAt,
      folderName: schema.Folder.name,
      folderPath: schema.Folder.path,
    })
    .from(schema.FolderFile)
    .leftJoin(schema.Folder, eq(schema.FolderFile.folderId, schema.Folder.id))
    .where(where)
    .orderBy(asc(schema.FolderFile.path), asc(schema.FolderFile.name), asc(schema.FolderFile.id))
    .limit(limit)

  return rows as FilesystemFileRow[]
}

/**
 * Every live, unarchived folder in the organization.
 *
 * Archived folders stay hidden even when `includeArchived` is set, which is what
 * the legacy did. The option has no caller that sets it, so widening it here
 * would be an unforced behaviour change dressed up as a refactor.
 */
async function selectFolders(ctx: FilesCtx): Promise<FilesystemFolderRow[]> {
  const rows = await ctx.db
    .select({
      id: schema.Folder.id,
      name: schema.Folder.name,
      parentId: schema.Folder.parentId,
      path: schema.Folder.path,
      depth: schema.Folder.depth,
      createdAt: schema.Folder.createdAt,
      updatedAt: schema.Folder.updatedAt,
      deletedAt: schema.Folder.deletedAt,
      isArchived: schema.Folder.isArchived,
      organizationId: schema.Folder.organizationId,
      createdById: schema.Folder.createdById,
    })
    .from(schema.Folder)
    .where(
      and(
        eq(schema.Folder.organizationId, ctx.organizationId),
        isNull(schema.Folder.deletedAt),
        eq(schema.Folder.isArchived, false)
      )
    )
    .orderBy(asc(schema.Folder.depth), asc(schema.Folder.path))

  return rows as FilesystemFolderRow[]
}

/** The three planner columns for the selected files. No query for an empty selection. */
async function selectMoveFiles(ctx: FilesCtx, fileIds: string[]): Promise<MoveFileRow[]> {
  if (fileIds.length === 0) return []
  const rows = await ctx.db
    .select({
      id: schema.FolderFile.id,
      name: schema.FolderFile.name,
      folderId: schema.FolderFile.folderId,
    })
    .from(schema.FolderFile)
    .where(
      and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        inArray(schema.FolderFile.id, fileIds),
        isNull(schema.FolderFile.deletedAt)
      )
    )
  return rows as MoveFileRow[]
}

/**
 * The names of the live files sitting directly in `folderId` (`null` = root).
 *
 * One statement for the whole collision check, in exchange for holding the
 * target folder's file names in memory. That is the same trade PR 5d took for
 * the folder hierarchy, and for the same reason: the alternative is a query per
 * item **and** a query per rename candidate, which is what the legacy did and
 * what made a bulk move into a busy folder pathologically slow.
 */
async function selectFileNamesIn(ctx: FilesCtx, folderId: string | null): Promise<string[]> {
  const rows = await ctx.db
    .select({ name: schema.FolderFile.name })
    .from(schema.FolderFile)
    .where(
      and(
        eq(schema.FolderFile.organizationId, ctx.organizationId),
        folderId ? eq(schema.FolderFile.folderId, folderId) : isNull(schema.FolderFile.folderId),
        isNull(schema.FolderFile.deletedAt)
      )
    )
  return (rows as Array<{ name: string }>).map((row) => row.name)
}
