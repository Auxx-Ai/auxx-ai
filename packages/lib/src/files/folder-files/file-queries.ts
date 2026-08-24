// packages/lib/src/files/folder-files/file-queries.ts

/**
 * `FolderFile` reads — the file-library half of `files/`.
 *
 * Split from `folder-files/file-mutations.ts` and
 * `folder-files/version-mutations.ts` per `docs/lib-module-guide.md` §5 — "a
 * file that both queries and mutates is the first step back toward a service
 * class", which is exactly how `core/file-service.ts` reached 1,982 lines for a
 * surface its router used twenty times.
 *
 * ## Every read here is organization-scoped, unconditionally
 *
 * `FileService` scoped through `BaseService.buildBaseWhereClause`, whose
 * organization filter is guarded by `if (this.organizationId)`. Three production
 * sites construct the service with no organization at all
 * (`new FileService(organizationId)` is the *good* case; `documents/render.ts`
 * and the workflow file-context service pass one, but `BaseService` cannot
 * require it), so a missing scope silently widened every statement to every
 * tenant. `FilesCtx.organizationId` is required, so the filter is not
 * conditional any more.
 *
 * `FolderFile.organizationId` is `NOT NULL`, so an `eq(...)` filter hides no
 * rows here.
 *
 * ## Versions are scoped through their file, never directly
 *
 * `FileVersion` carries no `organizationId` — its only tenant link is `fileId`.
 * So every version read below first resolves the file through
 * {@link requireFolderFile} (which is org-scoped) and constrains on `fileId`.
 * The legacy `getLatestVersion` skipped that step and queried versions by bare
 * `fileId`, which returned another tenant's version to anyone holding the id;
 * `getVersions` / `getVersion` / `getCurrentVersion` all resolved the file first
 * but then issued the version statement with no scope of its own.
 */

import { schema } from '@auxx/database'
import type {
  FileVersionEntity,
  FolderFileEntity,
  StorageLocationEntity,
} from '@auxx/database/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { ConflictError, NotFoundError } from '../../errors'
import type { FileSearchResult, FolderFileWithRelations } from '../core/types'
import type { FilesCtx } from '../ctx'
import { guard, unwrap } from '../guard'

/**
 * A `FileVersion` row with its `StorageLocation` joined in.
 *
 * Every consumer of a version in this module wants the location too (to
 * presign, to copy, to read content), so the joined shape is the default rather
 * than a second round-trip per caller. Mirrors
 * `assets/asset-queries.ts`'s `AssetVersionWithLocation` so the two libraries
 * read the same way.
 */
export type FileVersionWithLocation = FileVersionEntity & {
  storageLocation: StorageLocationEntity | null
}

/**
 * Knobs for {@link listFolderFiles}.
 *
 * A closed set of filters, replacing the legacy `filters?: Record<string, any>`
 * that `FileService.buildFilterConditions` fed through a
 * `(schema.FolderFile as Record<string, any>)[key]` lookup — any string key
 * became a `WHERE`, and nested `{ contains, mode, gte, lte, in }` objects became
 * operators. That is an injection surface with no caller: the only two callers
 * (`list` and `listInFolder`) pass a fixed handful of fields.
 */
export interface ListFolderFilesOptions {
  /** `undefined` lists across every folder; `null` lists the organization root. */
  folderId?: string | null
  /** Extensions, with or without a leading dot — normalised to lowercase here. */
  fileTypes?: string[]
  /**
   * Only `false` filters. `undefined` leaves archived rows in, which is the
   * legacy `listInFolder` behaviour (`options.includeArchived === false &&
   * { isArchived: false }`) and what the router relies on.
   */
  includeArchived?: boolean
  includeDeleted?: boolean
  limit?: number
  offset?: number
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'size' | 'path'
  sortOrder?: 'asc' | 'desc'
}

/**
 * One page of files.
 *
 * Unlike `assets/`'s `AssetPage`, `total` here really is the count of matching
 * rows: `FileService.list` always issued the second `count()` query, so
 * `hasMore` is computed from the true total rather than from a full page.
 */
export interface FolderFilePage {
  items: FolderFileEntity[]
  total: number
  hasMore: boolean
}

/** Knobs for {@link searchFolderFiles}. A narrowed `SearchOptions` — see the function docs. */
export interface SearchFolderFilesOptions {
  limit?: number
  offset?: number
  fileTypes?: string[]
  sizeLimits?: { min?: number; max?: number }
  dateLimits?: { createdAfter?: Date; createdBefore?: Date }
}

/** How many `name (n).ext` candidates {@link resolveUniqueFilePath} will try before giving up. */
export const MAX_PATH_COLLISION_ATTEMPTS = 100

const SORT_COLUMNS = {
  name: schema.FolderFile.name,
  createdAt: schema.FolderFile.createdAt,
  updatedAt: schema.FolderFile.updatedAt,
  size: schema.FolderFile.size,
  path: schema.FolderFile.path,
} as const

/** Strip a leading dot and lowercase, so `'.PDF'` and `'pdf'` are the same filter. */
function normalizeExtension(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '')
}

/** The organization + soft-delete pair every statement in this module starts from. */
function baseScope(ctx: FilesCtx, includeDeleted = false): SQL[] {
  const filters: SQL[] = [eq(schema.FolderFile.organizationId, ctx.organizationId)]
  if (!includeDeleted) filters.push(isNull(schema.FolderFile.deletedAt))
  return filters
}

/**
 * Load one live file, scoped to the caller's organization.
 *
 * Returns `ok(null)` when the file does not exist, is soft-deleted, or belongs
 * to another organization — the three collapse into one answer so a caller
 * cannot probe for ids outside its tenant.
 *
 * @param ctx Scope and database. Runs unchanged on a pool or inside a caller's
 *   transaction, because `FilesCtx.db` is `Database | Transaction`.
 * @param fileId The `FolderFile.id` to load.
 */
export async function getFolderFile(
  ctx: FilesCtx,
  fileId: string
): Promise<Result<FolderFileEntity | null, AuxxError>> {
  return guard(
    async () => {
      const [file] = await ctx.db
        .select()
        .from(schema.FolderFile)
        .where(and(eq(schema.FolderFile.id, fileId), ...baseScope(ctx)))
        .limit(1)
      return (file as FolderFileEntity | undefined) ?? null
    },
    'Failed to get file',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * Load one live file with its folder, versions, attachments and creator populated.
 *
 * The relation set matches `FileService.getWithRelations` exactly — folder
 * (id/name/path), current version with its location, all versions newest-first
 * with their locations, attachments, and the creator's id/name/email. Callers
 * that only need the row should use {@link getFolderFile}: this issues a
 * considerably wider query.
 */
export async function getFolderFileWithRelations(
  ctx: FilesCtx,
  fileId: string
): Promise<Result<FolderFileWithRelations | null, AuxxError>> {
  return guard(
    async () => {
      const file = await ctx.db.query.FolderFile.findFirst({
        where: and(eq(schema.FolderFile.id, fileId), ...baseScope(ctx)),
        with: {
          folder: { columns: { id: true, name: true, path: true } },
          currentVersion: { with: { storageLocation: true } },
          versions: {
            with: { storageLocation: true },
            orderBy: desc(schema.FileVersion.versionNumber),
          },
          attachments: true,
          createdBy: { columns: { id: true, name: true, email: true } },
        },
      })
      return (file as FolderFileWithRelations | undefined) ?? null
    },
    'Failed to get file with relations',
    { fileId, organizationId: ctx.organizationId }
  )
}

/**
 * List files in the caller's organization, optionally within one folder.
 *
 * Replaces both `FileService.list` and `FileService.listInFolder` — the latter
 * was a thin argument shuffle over the former plus an `includeCounts` branch
 * that issued a `GROUP BY` nobody ever asked for (`fileRouter.list`, its only
 * caller, never sets the flag). One function, one query pair.
 *
 * @param ctx Scope and database.
 * @param options Filters, paging and sort. See {@link ListFolderFilesOptions}
 *   for why the filter set is closed rather than an arbitrary column map.
 */
export async function listFolderFiles(
  ctx: FilesCtx,
  options: ListFolderFilesOptions = {}
): Promise<Result<FolderFilePage, AuxxError>> {
  return guard(
    async () => {
      const filters = baseScope(ctx, options.includeDeleted)

      if (options.folderId !== undefined) {
        filters.push(
          options.folderId === null
            ? isNull(schema.FolderFile.folderId)
            : eq(schema.FolderFile.folderId, options.folderId)
        )
      }
      if (options.fileTypes?.length) {
        filters.push(inArray(schema.FolderFile.ext, options.fileTypes.map(normalizeExtension)))
      }
      // Only an explicit `false` filters — see ListFolderFilesOptions.
      if (options.includeArchived === false) {
        filters.push(eq(schema.FolderFile.isArchived, false))
      }

      const where = and(...filters)
      const limit = options.limit ?? 50
      const offset = options.offset ?? 0
      const sortColumn = SORT_COLUMNS[options.sortBy ?? 'updatedAt']
      const orderBy = options.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn)

      const [items, totals] = await Promise.all([
        ctx.db
          .select()
          .from(schema.FolderFile)
          .where(where)
          .orderBy(orderBy)
          .offset(offset)
          .limit(limit),
        ctx.db.select({ value: count() }).from(schema.FolderFile).where(where),
      ])

      const total = Number(totals[0]?.value ?? 0)
      return {
        items: items as FolderFileEntity[],
        total,
        hasMore: offset + items.length < total,
      }
    },
    'Failed to list files',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Relevance-scored file search across name, path, extension and MIME type.
 *
 * The scoring is inherited verbatim from `FileService.search` (exact name 10,
 * partial name 5, path 3, ext 2, mime 2, floor of 1) so a result ordering does
 * not change under cover of a refactor.
 *
 * **Two dead branches were dropped rather than ported.**
 * `SearchOptions.includeContent` selected a five-table join through
 * `getFileSelectFields()` and then cast each row `as FolderFile` and read
 * `file.name` off it — the nested `folder` / `currentVersion` / `storageLocation`
 * groups were never read by anything, and no caller has ever set the flag. And
 * `(options as Record<string, any>).folderId` was a cast, because `SearchOptions`
 * declares no such field; `fileRouter.search` filters by folder on the results
 * instead, which is left untouched here.
 *
 * @param ctx Scope and database.
 * @param query The user's text. A blank query returns `ok([])` without touching
 *   the database — asserted, because it is the cheap guard in front of four
 *   `ILIKE '%%'` scans.
 * @param options Paging plus the size/date/extension filters the legacy method took.
 */
export async function searchFolderFiles(
  ctx: FilesCtx,
  query: string,
  options: SearchFolderFilesOptions = {}
): Promise<Result<FileSearchResult[], AuxxError>> {
  return guard(
    async () => {
      const trimmed = query.trim()
      if (!trimmed) return []
      const lowercase = trimmed.toLowerCase()

      const filters = baseScope(ctx)

      const matches = or(
        ilike(schema.FolderFile.name, `%${trimmed}%`),
        ilike(schema.FolderFile.path, `%${trimmed}%`),
        ilike(schema.FolderFile.ext, `%${lowercase}%`),
        ilike(schema.FolderFile.mimeType, `%${trimmed}%`)
      )
      if (matches) filters.push(matches)

      if (options.fileTypes?.length) {
        filters.push(inArray(schema.FolderFile.ext, options.fileTypes.map(normalizeExtension)))
      }
      if (options.sizeLimits?.min !== undefined) {
        filters.push(gte(schema.FolderFile.size, options.sizeLimits.min))
      }
      if (options.sizeLimits?.max !== undefined) {
        filters.push(lte(schema.FolderFile.size, options.sizeLimits.max))
      }
      if (options.dateLimits?.createdAfter) {
        filters.push(gte(schema.FolderFile.createdAt, options.dateLimits.createdAfter))
      }
      if (options.dateLimits?.createdBefore) {
        filters.push(lte(schema.FolderFile.createdAt, options.dateLimits.createdBefore))
      }

      const rows = (await ctx.db
        .select()
        .from(schema.FolderFile)
        .where(and(...filters))
        .orderBy(desc(schema.FolderFile.updatedAt))
        .limit(options.limit ?? 50)
        .offset(options.offset ?? 0)) as FolderFileEntity[]

      return rows
        .map((file) => scoreFile(file, lowercase))
        .sort((a, b) => b.relevance - a.relevance)
    },
    'Failed to search files',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Files with one of the given extensions, name-ordered.
 *
 * Extensions are normalised (leading dot stripped, lowercased) and matched with
 * equality rather than `LIKE`, because the write path lowercases `ext` on every
 * insert and update.
 */
export async function findFolderFilesByExtension(
  ctx: FilesCtx,
  extensions: string[],
  options: { limit?: number } = {}
): Promise<Result<FolderFileEntity[], AuxxError>> {
  return guard(
    async () => {
      if (extensions.length === 0) return []
      const rows = await ctx.db
        .select()
        .from(schema.FolderFile)
        .where(
          and(inArray(schema.FolderFile.ext, extensions.map(normalizeExtension)), ...baseScope(ctx))
        )
        .orderBy(asc(schema.FolderFile.name))
        .limit(options.limit ?? 50)
      return rows as FolderFileEntity[]
    },
    'Failed to find files by extension',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Files whose MIME type contains any of the given patterns, name-ordered.
 *
 * **This fixes two defects in `FileService.findByMimeType` rather than porting
 * them.** That method was typed `mimeType: string | string[]` but built its
 * predicate as `` `%${mimeType}%` ``, so an array arrived as
 * `%image/png,application/pdf%` — a pattern that matches nothing. Its only
 * caller, `fileRouter.findByMimeType`, passes an array, so the procedure has
 * always returned `[]`. It also declared `options: { limit: number }` and never
 * applied it. Both are corrected here: one `ILIKE` per pattern, `OR`-ed, with
 * the limit bound into the statement.
 */
export async function findFolderFilesByMimeType(
  ctx: FilesCtx,
  mimeTypes: string[],
  options: { limit?: number } = {}
): Promise<Result<FolderFileEntity[], AuxxError>> {
  return guard(
    async () => {
      if (mimeTypes.length === 0) return []
      const matches = or(
        ...mimeTypes.map((mimeType) => ilike(schema.FolderFile.mimeType, `%${mimeType}%`))
      )
      const rows = await ctx.db
        .select()
        .from(schema.FolderFile)
        .where(and(...(matches ? [matches] : []), ...baseScope(ctx)))
        .orderBy(asc(schema.FolderFile.name))
        .limit(options.limit ?? 50)
      return rows as FolderFileEntity[]
    },
    'Failed to find files by MIME type',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Live files with no `currentVersionId` — the maintenance sweep's input.
 *
 * A file with no current version has nothing to download; `lifecycle/`'s
 * orphaned-file cleanup is the only caller.
 */
export async function findOrphanedFolderFiles(
  ctx: FilesCtx
): Promise<Result<FolderFileEntity[], AuxxError>> {
  return guard(
    async () => {
      const rows = await ctx.db
        .select()
        .from(schema.FolderFile)
        .where(and(isNull(schema.FolderFile.currentVersionId), ...baseScope(ctx)))
      return rows as FolderFileEntity[]
    },
    'Failed to find orphaned files',
    { organizationId: ctx.organizationId }
  )
}

/**
 * Every version of a file, newest version number first, locations joined in.
 */
export async function getFolderFileVersions(
  ctx: FilesCtx,
  fileId: string
): Promise<Result<FileVersionWithLocation[], AuxxError>> {
  return guard(async () => {
    await requireFolderFile(ctx, fileId)
    const versions = await ctx.db.query.FileVersion.findMany({
      where: eq(schema.FileVersion.fileId, fileId),
      with: { storageLocation: true },
      orderBy: desc(schema.FileVersion.versionNumber),
    })
    return versions as FileVersionWithLocation[]
  }, 'Failed to list file versions')
}

/**
 * One version of a file by its human-facing version *number*.
 *
 * Note the two id spaces: `versionNumber` is the 1-based counter the UI shows
 * and `fileRouter` addresses versions by, while `FileVersion.id` is a cuid. The
 * two must not be confused at a call site — `fileRouter.deleteVersion` used to
 * pass a version id into the `fileId` slot, and every call threw "file not
 * found".
 */
export async function getFolderFileVersionByNumber(
  ctx: FilesCtx,
  fileId: string,
  versionNumber: number
): Promise<Result<FileVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    await requireFolderFile(ctx, fileId)
    const version = await ctx.db.query.FileVersion.findFirst({
      where: and(
        eq(schema.FileVersion.fileId, fileId),
        eq(schema.FileVersion.versionNumber, versionNumber)
      ),
      with: { storageLocation: true },
    })
    return (version as FileVersionWithLocation | undefined) ?? null
  }, 'Failed to get file version')
}

/**
 * Resolve the current version of a file, with its storage location.
 *
 * Prefers the file's explicit `currentVersionId` and falls back to the highest
 * `versionNumber` when the pointer is null — the same two-branch resolution
 * `folder-files/download.ts` performs, kept identical so a download and a
 * content read can never disagree about which bytes are current.
 *
 * Returns `ok(null)` when the file has no version at all. Throws
 * `NotFoundError` when the *file* is missing, because "which version is current
 * for a file that does not exist" has no null answer worth returning.
 */
export async function getFolderFileCurrentVersion(
  ctx: FilesCtx,
  fileId: string
): Promise<Result<FileVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    const file = await requireFolderFile(ctx, fileId)
    return loadCurrentFileVersion(ctx, file)
  }, 'Failed to get current file version')
}

/**
 * The highest-numbered version of a file, regardless of `currentVersionId`.
 *
 * **Behaviour change:** the legacy `getLatestVersion` queried `FileVersion` by
 * bare `fileId` and never loaded the file, so no statement in it carried an
 * organization filter. This resolves the file first, so a version belonging to
 * another tenant is simply not reachable.
 */
export async function getLatestFolderFileVersion(
  ctx: FilesCtx,
  fileId: string
): Promise<Result<FileVersionWithLocation | null, AuxxError>> {
  return guard(async () => {
    await requireFolderFile(ctx, fileId)
    const version = await ctx.db.query.FileVersion.findFirst({
      where: eq(schema.FileVersion.fileId, fileId),
      with: { storageLocation: true },
      orderBy: desc(schema.FileVersion.versionNumber),
    })
    return (version as FileVersionWithLocation | undefined) ?? null
  }, 'Failed to get latest file version')
}

/**
 * Which version to serve. `versionNumber` is the 1-based UI counter, never a row id.
 *
 * Spelled the same way as `AssetVersionSelector` on purpose — the two libraries
 * are twins, and a caller that has to remember which one speaks
 * `number | 'latest' | 'current'` is a caller that will eventually pass the
 * wrong thing.
 */
export type FolderFileVersionSelector = number | 'latest' | 'current'

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * Turn a {@link FolderFileVersionSelector} into a version row, location joined in.
 *
 * **The single implementation of "which version did the caller mean" for the
 * file library.** It lives here, next to the version reads it composes, rather
 * than inside `folder-files/download.ts`, because it now has two consumers —
 * `getFolderFileDownloadRef` and `getFolderFileContent` — and a second copy is
 * precisely how a download and a content read start disagreeing about which
 * bytes are current. `assets/asset-queries.ts` holds the twin for assets.
 *
 * `'current'` follows `currentVersionId` (falling back to the highest number),
 * `'latest'` always takes the highest number — the two differ after a
 * `restoreFileVersion` — and a number addresses the version by its UI counter.
 * Every branch constrains on `file.id`, so a version belonging to another file
 * (and possibly another org) cannot be served through a file the caller can see.
 *
 * The `'latest'` branch queries directly rather than calling
 * {@link getLatestFolderFileVersion}, which would re-run {@link requireFolderFile}
 * on a row the caller has already loaded. That asymmetry with the numeric branch
 * is inherited verbatim from `download.ts` and is preserved rather than tidied:
 * changing the number of statements a download issues is not this move's job.
 *
 * Throws rather than returning `Result`: it is a helper, and every caller is
 * already inside a {@link guard}.
 *
 * @param ctx Scope. `ctx.db` may be a pool or a transaction.
 * @param file The file the caller has already loaded, org-scoped.
 * @param selector Which version. Callers default this to `'current'`.
 * @throws {NotFoundError} when the addressed version does not exist for this file.
 */
export async function resolveFolderFileVersion(
  ctx: FilesCtx,
  file: FolderFileEntity,
  selector: FolderFileVersionSelector
): Promise<FileVersionWithLocation> {
  let version: FileVersionWithLocation | null

  if (selector === 'current') {
    version = await loadCurrentFileVersion(ctx, file)
  } else if (selector === 'latest') {
    version = ((await ctx.db.query.FileVersion.findFirst({
      where: eq(schema.FileVersion.fileId, file.id),
      with: { storageLocation: true },
      orderBy: desc(schema.FileVersion.versionNumber),
    })) ?? null) as FileVersionWithLocation | null
  } else {
    version = unwrap(await getFolderFileVersionByNumber(ctx, file.id, selector))
  }

  if (!version) throw new NotFoundError(`Version ${selector} not found for file ${file.id}`)
  return version
}

/**
 * Load a live file or throw `NotFoundError`.
 *
 * Exported for the mutation modules, which all need the same org-scoped
 * existence check before they write, and must throw rather than return `err()`
 * so a failure inside a caller's transaction rolls it back.
 */
export async function requireFolderFile(ctx: FilesCtx, fileId: string): Promise<FolderFileEntity> {
  const [file] = await ctx.db
    .select()
    .from(schema.FolderFile)
    .where(and(eq(schema.FolderFile.id, fileId), ...baseScope(ctx)))
    .limit(1)
  if (!file) throw new NotFoundError(`File ${fileId} not found`)
  return file as FolderFileEntity
}

/**
 * The `currentVersionId`-then-highest-number resolution, on an already-loaded
 * file. Exported for the download and mutation modules so neither re-fetches the
 * file.
 */
export async function loadCurrentFileVersion(
  ctx: FilesCtx,
  file: FolderFileEntity
): Promise<FileVersionWithLocation | null> {
  const version = file.currentVersionId
    ? await ctx.db.query.FileVersion.findFirst({
        where: and(
          eq(schema.FileVersion.id, file.currentVersionId),
          eq(schema.FileVersion.fileId, file.id)
        ),
        with: { storageLocation: true },
      })
    : await ctx.db.query.FileVersion.findFirst({
        where: eq(schema.FileVersion.fileId, file.id),
        with: { storageLocation: true },
        orderBy: desc(schema.FileVersion.versionNumber),
      })
  return (version as FileVersionWithLocation | undefined) ?? null
}

/**
 * Pick a path for `fileName` inside `folderId` that no live file already holds.
 *
 * A read that only the write path uses, so it lives here rather than in
 * `file-mutations.ts`. Two things changed from `FileService.generateFilePath`:
 *
 * - **The parent-folder lookup is organization-scoped.** The legacy body read
 *   `SELECT path FROM Folder WHERE id = ?` with no scope, so a caller holding a
 *   folder id from another tenant got that folder's path stamped onto its own
 *   file. `move` and `copy` happened to validate the target folder org-scoped
 *   first, so this was defence-in-depth rather than a live hole — but `rename`
 *   and `create` reached it directly.
 * - **The collision scan is bounded.** The legacy `while (true)` had no ceiling;
 *   a folder holding many `name (n).ext` siblings issued one query per candidate
 *   forever. {@link MAX_PATH_COLLISION_ATTEMPTS} caps it and fails loudly.
 *
 * @throws {NotFoundError} when `folderId` names no folder in this organization.
 * @throws {ConflictError} when no free name is found within the attempt ceiling.
 */
export async function resolveUniqueFilePath(
  ctx: FilesCtx,
  folderId: string | null,
  fileName: string
): Promise<string> {
  // Path separators and surrounding whitespace would make the stored `path`
  // ambiguous, so they never reach the column.
  const safeName = fileName.replace(/[/\\]/g, '').trim() || 'untitled'

  let basePath = ''
  if (folderId) {
    const [folder] = await ctx.db
      .select({ path: schema.Folder.path })
      .from(schema.Folder)
      .where(
        and(
          eq(schema.Folder.id, folderId),
          eq(schema.Folder.organizationId, ctx.organizationId),
          isNull(schema.Folder.deletedAt)
        )
      )
      .limit(1)
    if (!folder?.path) throw new NotFoundError(`Folder ${folderId} not found`)
    basePath = folder.path
  }

  const dot = safeName.lastIndexOf('.')
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName
  const ext = dot > 0 ? safeName.slice(dot) : ''

  for (let attempt = 0; attempt <= MAX_PATH_COLLISION_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` (${attempt})`
    const candidate = `${basePath}/${stem}${suffix}${ext}`.replace(/\/+/g, '/')

    const [taken] = await ctx.db
      .select({ id: schema.FolderFile.id })
      .from(schema.FolderFile)
      .where(
        and(
          eq(schema.FolderFile.organizationId, ctx.organizationId),
          folderId === null
            ? isNull(schema.FolderFile.folderId)
            : eq(schema.FolderFile.folderId, folderId),
          eq(schema.FolderFile.path, candidate)
        )
      )
      .limit(1)

    if (!taken) return candidate
  }

  throw new ConflictError(
    `Could not find a free path for "${safeName}" after ${MAX_PATH_COLLISION_ATTEMPTS} attempts`
  )
}

/** The relevance scoring inherited verbatim from `FileService.search`. */
function scoreFile(file: FolderFileEntity, lowercaseQuery: string): FileSearchResult {
  let relevance = 0
  const matchedFields: string[] = []

  if (file.name?.toLowerCase() === lowercaseQuery) {
    relevance += 10
    matchedFields.push('name')
  } else if (file.name?.toLowerCase().includes(lowercaseQuery)) {
    relevance += 5
    matchedFields.push('name')
  }
  if (file.path?.toLowerCase().includes(lowercaseQuery)) {
    relevance += 3
    matchedFields.push('path')
  }
  if (file.ext?.toLowerCase().includes(lowercaseQuery)) {
    relevance += 2
    matchedFields.push('ext')
  }
  if (file.mimeType?.toLowerCase().includes(lowercaseQuery)) {
    relevance += 2
    matchedFields.push('mimeType')
  }

  const parts: string[] = []
  if (file.name.toLowerCase().includes(lowercaseQuery)) parts.push(`Name: ${file.name}`)
  if (file.path.toLowerCase().includes(lowercaseQuery)) parts.push(`Path: ${file.path}`)
  if (file.mimeType?.toLowerCase().includes(lowercaseQuery)) parts.push(`Type: ${file.mimeType}`)

  return {
    file,
    relevance: Math.max(relevance, 1),
    matchedFields,
    snippet: parts.join(' | ') || file.name,
  }
}
