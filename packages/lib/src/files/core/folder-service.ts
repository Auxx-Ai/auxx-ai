// packages/lib/src/files/core/folder-service.ts

/**
 * @deprecated A thin, deprecated facade over `files/folders/`.
 *
 * Every method below delegates to a function in `files/folders/folder-queries.ts`,
 * `folder-mutations.ts` or `tree.ts`. The class survives only because it has 20
 * external construction sites (23 in `folderRouter`, 4 in `FilesystemService`);
 * **PR 5h / Phase 10 move those and delete this file.** Do not add a method
 * here — add a function to `files/folders/` and call it with a `FilesCtx`.
 *
 * ## What changed for callers of this class, and nothing else did
 *
 * - **Errors are `AuxxError` subclasses**, not bare `Error`. A missing folder is
 *   a `NotFoundError` (404), a name collision or an attempted cycle a
 *   `ConflictError` (409), an illegal name a `BadRequestError` (400), so
 *   `auxxErrorMiddleware` maps them instead of returning 500 for everything.
 * - **Organization scope is in every statement**, including the `UPDATE`s and
 *   the hard `DELETE`. See `folders/folder-mutations.ts`'s header for the five
 *   statements that had no scope at all.
 * - **The delete/restore/permanent-delete cascade selects files by `folderId`,
 *   not by path prefix.** The legacy statements used
 *   `ilike(FolderFile.path, `${folder.path}%`)` — no trailing slash, unescaped
 *   `LIKE` metacharacters — so deleting `/Doc` also deleted every file under
 *   `/Documents`, and `permanentDelete` erased them for good. This is the one
 *   change here that alters what rows a production call touches, and it is a
 *   fix.
 * - **Cycle detection walks `parentId`, not `path`.** A stale path used to let a
 *   folder be moved under its own descendant; `getAncestors` then looped
 *   forever on the result, because it had no visited set.
 * - **`getFolderTree` reports real file counts.** The legacy node builder read
 *   `folder._count?.files`, a Prisma field Drizzle never produces, so every
 *   `fileCount` and `totalSize` in the tree was `0` — while the query behind it
 *   eagerly loaded every file row in the organization to compute them. It also
 *   no longer drops folders whose parent is soft-deleted.
 * - **`merge` refuses to merge a folder into its own subtree** rather than
 *   creating the cycle.
 * - **`getUsage().mostActiveSubfolder` is the subtree with the most recent file
 *   activity**, not whichever direct child sorted last alphabetically (the
 *   legacy ordered by `folders.name` descending, with a comment conceding it).
 *
 * ## Deleted outright rather than ported, all verified zero-caller
 *
 * `count`, `getStats`, `getFolderStats`, `getContents`, `getFolderPath`,
 * `getRecent`, `getByCreator`, `findByPathPattern`, `isAncestor`,
 * `checkCircularReference`, `validate`, `moveToParent`, and the `static
 * computePath(folder)` that only read `folder.path ?? '/'`.
 *
 * Three were duplicate spellings of a survivor: `moveToParent` (== `move`),
 * `checkCircularReference` (a one-line pass-through to the private
 * `wouldCreateCircularReference`), and `static computePath` (which shares a name
 * with, but is unrelated to, the real path computation).
 *
 * The `BaseService` scaffolding went with them: `processCreateData`,
 * `getFolderSelectFields`, `getRelationIncludes` (already `@deprecated` and
 * returning a `{ _isDrizzleQuery: true }` marker nothing read), `getSearchFields`,
 * `buildScopedWhere`, and `buildFilterConditions` — 80 lines that translated a
 * free-form `Record<string, any>` into Drizzle conditions by indexing
 * `(schema.Folder as any)[key]`, for a `list()` whose only caller passes no
 * arguments.
 *
 * `rebuildPaths`, `fixDepths` and `cleanupEmpty` are also zero-caller but were
 * **kept**, rewritten on the pure core, in `files/folders/maintenance.ts` — see
 * that file's header for why.
 */

import type { Transaction } from '@auxx/database'
import { database as db } from '@auxx/database'
import type { FolderEntity as Folder } from '@auxx/database/types'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { copyFileVersions } from '../folder-files'
import {
  copyFolder,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  mergeFolders,
  moveFolder,
  permanentlyDeleteFolder,
  renameFolder,
  restoreFolder,
  updateFolder,
} from '../folders/folder-mutations'
import type {
  FolderCounts,
  FolderDetail,
  FolderPage,
  FolderSearchHit,
  FolderUsage,
} from '../folders/folder-queries'
import {
  getFolder,
  getFolderAncestors,
  getFolderCounts,
  getFolderDescendants,
  getFolderTree,
  getFolderUsage,
  getFolderWithRelations,
  getSubfolders,
  isFolderNameAvailable,
  listFolders,
  searchFolders,
} from '../folders/folder-queries'
import type { FileVersionCopyPort, FolderCopyDeps, FolderWriteDeps } from '../folders/ports'
import type { FolderTreeNode } from '../folders/tree'
import { BaseService, type DatabaseClient } from './base-service'
import type { CreateFolderRequest, SearchOptions, UpdateFolderRequest } from './types'

export type { FolderCounts, FolderDetail, FolderUsage } from '../folders/folder-queries'

/**
 * @deprecated See the file header. Delegates to `files/folders/`; deleted in Phase 10.
 */
export class FolderService extends BaseService<
  Folder,
  FolderDetail,
  CreateFolderRequest,
  UpdateFolderRequest,
  FolderSearchHit
> {
  constructor(organizationId?: string, userId?: string, dbInstance: DatabaseClient = db) {
    super(organizationId, userId, dbInstance)
  }

  protected getEntityName(): string {
    return 'folder'
  }

  /**
   * @deprecated Unused. Creation runs through `folders/folder-mutations.ts`,
   * which validates the name, resolves the parent and computes `path`/`depth`
   * itself. Present only because `BaseService` declares this abstract.
   */
  protected async processCreateData(data: CreateFolderRequest): Promise<CreateFolderRequest> {
    return data
  }

  // ============= Reads =============

  /** @deprecated Use `getFolder(ctx, folderId)`. */
  async get(id: string, dbClient?: DatabaseClient): Promise<Folder | null> {
    return this.unwrap(await getFolder(this.filesCtx(dbClient), id))
  }

  /** @deprecated Use `getFolderWithRelations(ctx, folderId)`. */
  async getWithRelations(id: string, dbClient?: DatabaseClient): Promise<FolderDetail | null> {
    return this.unwrap(await getFolderWithRelations(this.filesCtx(dbClient), id))
  }

  /** @deprecated Use `listFolders(ctx, options)`. */
  async list(options: { limit?: number; offset?: number } = {}): Promise<FolderPage> {
    return this.unwrap(await listFolders(this.filesCtx(), options))
  }

  /** @deprecated Use `getFolderTree(ctx)`. */
  async getFolderTree(): Promise<FolderTreeNode[]> {
    return this.unwrap(await getFolderTree(this.filesCtx()))
  }

  /** @deprecated Use `getSubfolders(ctx, parentId)`. */
  async getSubfolders(parentId: string | null): Promise<Folder[]> {
    return this.unwrap(await getSubfolders(this.filesCtx(), parentId))
  }

  /** @deprecated Use `getFolderAncestors(ctx, folderId)`. */
  async getAncestors(id: string): Promise<Folder[]> {
    return this.unwrap(await getFolderAncestors(this.filesCtx(), id))
  }

  /** @deprecated Use `getFolderDescendants(ctx, folderId)`. */
  async getDescendants(id: string): Promise<Folder[]> {
    return this.unwrap(await getFolderDescendants(this.filesCtx(), id))
  }

  /** @deprecated Use `searchFolders(ctx, query, options)`. */
  async search(query: string, options?: SearchOptions): Promise<FolderSearchHit[]> {
    return this.unwrap(
      await searchFolders(this.filesCtx(), query, {
        limit: options?.limit,
        offset: options?.offset,
        createdAfter: options?.dateLimits?.createdAfter,
        createdBefore: options?.dateLimits?.createdBefore,
      })
    )
  }

  /** @deprecated Use `getFolderUsage(ctx, folderId)`. */
  async getUsage(id: string): Promise<FolderUsage> {
    return this.unwrap(await getFolderUsage(this.filesCtx(), id))
  }

  /** @deprecated Use `isFolderNameAvailable(ctx, name, parentId, excludeId)`. */
  async validateName(name: string, parentId: string | null, excludeId?: string): Promise<boolean> {
    return this.unwrap(await isFolderNameAvailable(this.filesCtx(), name, parentId, excludeId))
  }

  /**
   * @deprecated Use `getFolderCounts(ctx, folderId)`, which returns all four
   * numbers from two statements.
   *
   * `folderRouter.getStats` calls the four accessors below in a `Promise.all`,
   * so through this facade they run the pair of statements four times over.
   * That is a **deliberate, transient** cost: the alternative is four separate
   * exported functions that then have to be collapsed again in 5h, and the
   * statements are indexed aggregates on one panel. PR 5h replaces the whole
   * `Promise.all` with one `getFolderCounts` call and this note goes away with
   * the class.
   */
  async getFolderSize(id: string): Promise<number> {
    return (await this.counts(id)).totalSize
  }

  /** @deprecated See {@link getFolderSize}. */
  async getDeepFileCount(id: string): Promise<number> {
    return (await this.counts(id)).deepFileCount
  }

  /** @deprecated See {@link getFolderSize}. */
  async getDirectFileCount(id: string): Promise<number> {
    return (await this.counts(id)).directFileCount
  }

  /** @deprecated See {@link getFolderSize}. */
  async getSubfolderCount(id: string): Promise<number> {
    return (await this.counts(id)).subfolderCount
  }

  // ============= Writes =============

  /**
   * @deprecated Use `createFolder(ctx, input, deps)`.
   *
   * `data.organizationId` is ignored: scope comes from the service's own
   * organization, closing the path where a caller could write a folder into an
   * organization it was not acting for.
   */
  async create(data: CreateFolderRequest, dbClient?: DatabaseClient): Promise<Folder> {
    return this.unwrap(
      await createFolder(
        this.filesCtx(dbClient),
        {
          name: data.name,
          parentId: data.parentId ?? null,
          createdById: data.createdById ?? this.userId ?? null,
        },
        this.writeDeps()
      )
    )
  }

  /** @deprecated Use `updateFolder(tx, ctx, folderId, input, deps)`. */
  async update(id: string, data: UpdateFolderRequest): Promise<Folder> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(await updateFolder(tx, this.filesCtx(), id, data, this.writeDeps()))
    )
  }

  /** @deprecated Use `renameFolder(tx, ctx, folderId, newName, deps)`. */
  async rename(id: string, newName: string): Promise<Folder> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(await renameFolder(tx, this.filesCtx(), id, newName, this.writeDeps()))
    )
  }

  /**
   * @deprecated Use `moveFolder(tx, ctx, folderId, newParentId, deps)`.
   *
   * The legacy `moveToParent` alias is gone; this is the surviving name. The
   * UI's `'root'` sentinel is still normalised to `null` — `FilesystemService`
   * forwards it unnormalised from `fileRouter`.
   */
  async move(id: string, newParentId: string | null): Promise<Folder> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(await moveFolder(tx, this.filesCtx(), id, newParentId, this.writeDeps()))
    )
  }

  /** @deprecated Use `deleteFolder(tx, ctx, folderId, deps)`. */
  async delete(id: string): Promise<void> {
    await this.inTransaction(undefined, async (tx) =>
      this.unwrap(await deleteFolder(tx, this.filesCtx(), id, this.writeDeps()))
    )
  }

  /** @deprecated Use `restoreFolder(tx, ctx, folderId, deps)`. */
  async restore(id: string): Promise<Folder> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(await restoreFolder(tx, this.filesCtx(), id, this.writeDeps()))
    )
  }

  /** @deprecated Use `permanentlyDeleteFolder(tx, ctx, folderId)`. */
  async permanentDelete(id: string): Promise<void> {
    await this.inTransaction(undefined, async (tx) =>
      this.unwrap(await permanentlyDeleteFolder(tx, this.filesCtx(), id))
    )
  }

  /** @deprecated Use `copyFolder(tx, ctx, input, deps)`. */
  async copy(sourceId: string, targetParentId: string | null, newName?: string): Promise<Folder> {
    return this.inTransaction(undefined, async (tx) =>
      this.unwrap(
        await copyFolder(
          tx,
          this.filesCtx(),
          { sourceId, targetParentId, newName, createdById: this.userId ?? null },
          this.copyDeps(tx)
        )
      )
    )
  }

  /** @deprecated Use `mergeFolders(tx, ctx, sourceId, targetId, deps)`. */
  async merge(sourceId: string, targetId: string): Promise<void> {
    await this.inTransaction(undefined, async (tx) =>
      this.unwrap(await mergeFolders(tx, this.filesCtx(), sourceId, targetId, this.writeDeps()))
    )
  }

  /** @deprecated Use `ensureFolderPath(ctx, path, deps, { createdById })`. */
  async ensurePath(path: string, userId?: string): Promise<Folder> {
    return this.unwrap(
      await ensureFolderPath(this.filesCtx(), path, this.writeDeps(), {
        createdById: userId ?? this.userId ?? null,
      })
    )
  }

  // ============= Internals =============

  /** {@link getFolderSize} and its three siblings share one read. */
  private async counts(id: string): Promise<FolderCounts> {
    return this.unwrap(await getFolderCounts(this.filesCtx(), id))
  }

  /**
   * Build the `FilesCtx` the extracted functions take.
   *
   * `requireOrganization()` throws when the service was constructed without one,
   * which is the legacy behaviour on every write path — and on the read paths it
   * *replaces* `buildBaseWhereClause`'s silent "no organization means no
   * filter", which returned rows from every tenant.
   */
  private filesCtx(dbClient?: DatabaseClient): FilesCtx {
    return {
      db: (dbClient ?? this.db) as FilesCtx['db'],
      organizationId: this.requireOrganization(),
    }
  }

  /** `Folder.updatedAt` has no default, so every write supplies a clock. */
  private writeDeps(): FolderWriteDeps {
    return { now: () => new Date() }
  }

  /**
   * {@link writeDeps} plus the file-version copier.
   *
   * `folders/` declares {@link FileVersionCopyPort} rather than importing
   * `folder-files/`, so the two modules stay independent; this is the one place
   * the port is bound to PR 5c's implementation. The legacy body did
   * `new FileService(this.organizationId, this.userId, this.db)` **inside the
   * per-file loop**, constructing a service per copied file.
   */
  private copyDeps(tx: Transaction): FolderCopyDeps {
    const ctx = this.filesCtx(tx)
    const files: FileVersionCopyPort = {
      copyFileVersions: async (sourceFileId: string, targetFileId: string) => {
        this.unwrap(await copyFileVersions(tx, ctx, sourceFileId, targetFileId))
      },
    }
    return { ...this.writeDeps(), files }
  }

  /**
   * Unwrap a `Result` into the throw-based contract this class has always had.
   *
   * The thrown value is an `AuxxError` subclass rather than the bare `Error` the
   * old bodies threw, which is the one deliberate change to this facade's
   * error behaviour.
   */
  private unwrap<T>(result: Result<T, AuxxError>): T {
    if (result.isErr()) throw result.error
    return result.value
  }

  /**
   * Run `fn` inside a transaction, reproducing `BaseService.getTx` exactly.
   *
   * This is the one place the facade casts, and it is unavoidable here:
   * `BaseService.db` and the legacy `db?` parameters are
   * `Database | Transaction`, while the extracted writes require a real
   * `Transaction` — which is the entire point of that parameter, since a pool in
   * the slot silently stops a multi-statement write from being atomic. Isolating
   * the cast keeps every new call site honest, and Phase 6 deletes it along with
   * `getTx`.
   *
   * `FilesystemService` constructs this class **on an open transaction** and
   * then calls `move` / `rename`; `getTx` detects the missing `transaction`
   * method and runs the body on that client, which is the behaviour those two
   * call sites depend on.
   */
  private async inTransaction<T>(
    client: DatabaseClient | undefined,
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    if (client) return fn(client as Transaction)
    return this.getTx((tx) => fn(tx as Transaction))
  }
}

/**
 * @deprecated Construct a `FilesCtx` and call `files/folders/` directly.
 *
 * @param organizationId - Organization to scope operations to
 * @param userId - Actor recorded on created rows
 */
export const createFolderService = (organizationId?: string, userId?: string) =>
  new FolderService(organizationId, userId, db)
