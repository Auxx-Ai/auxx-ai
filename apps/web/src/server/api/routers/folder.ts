// apps/web/src/server/api/routers/folder.ts

import type { Transaction } from '@auxx/database'
import type { FilesCtx } from '@auxx/lib/files/server'
import {
  copyFileVersions,
  copyFolder,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  type FolderCopyDeps,
  getFolderAncestors,
  getFolderCounts,
  getFolderDescendants,
  getFolderTree,
  getFolderUsage,
  getFolderWithRelations,
  getSubfolders,
  isFolderNameAvailable,
  listFolders,
  mergeFolders,
  moveFolder,
  permanentlyDeleteFolder,
  renameFolder,
  restoreFolder,
  searchFolders,
  updateFolder,
} from '@auxx/lib/files/server'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import type { Result } from 'neverthrow'
import { z } from 'zod'
import { createTRPCRouter, isAuxxError, permissionProcedure } from '~/server/api/trpc'
import { toFilesCtx, toFilesWriteDeps } from '~/server/lib/files-ctx'

const logger = createScopedLogger('api/folder')

/**
 * Unwrap a `files/` `Result` into this router's throw-based flow.
 *
 * Every `folders/` function returns `Promise<Result<T, AuxxError>>`. Rethrowing
 * the error unchanged is what lets {@link rethrow} hand `auxxErrorMiddleware` a
 * real status: a missing folder is 404, a name collision or an attempted cycle
 * 409, an illegal name 400. Before PR 5d every one of those was a bare `Error`.
 */
function unwrap<V>(result: Result<V, Error>): V {
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * The one `catch` body this router uses, so the twenty procedures below cannot
 * drift apart.
 *
 * **An `AuxxError` is rethrown as-is.** `apps/web`'s `auxxErrorMiddleware` maps
 * it to the status its class names; flattening it into `BAD_REQUEST` here — which
 * is what every procedure did while `FolderService` threw bare `Error`s — is the
 * exact failure `CLAUDE.md` names ("guard rethrows with `isAuxxError(e)`, not
 * `e instanceof TRPCError`, or the AuxxError gets flattened into a generic 500").
 * The message is unchanged either way, so the UI's error toast reads the same;
 * only the HTTP status improves.
 */
function rethrow(error: unknown, fallback: string): never {
  if (error instanceof TRPCError || isAuxxError(error)) throw error
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback,
  })
}

/**
 * The `deps` a folder copy takes: a clock, plus the file-version copier the
 * subtree walk fans out to.
 *
 * `folders/` declares `FileVersionCopyPort` rather than importing
 * `folder-files/`, so the two modules stay independent — this is where the port
 * is bound to PR 5c's implementation. Both the port and the copy run on the
 * caller's transaction, so a failure halfway rolls the whole subtree back; the
 * legacy body constructed a `FileService` *inside* the per-file loop.
 */
function folderCopyDeps(tx: Transaction, ctx: FilesCtx): FolderCopyDeps {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return {
    ...toFilesWriteDeps(),
    files: {
      copyFileVersions: async (sourceFileId: string, targetFileId: string) => {
        unwrap(await copyFileVersions(tx, txCtx, sourceFileId, targetFileId))
      },
    },
  }
}

// Input schemas
const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
})

const updateFolderSchema = z.object({
  folderId: z.string(),
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
})

const folderIdSchema = z.object({
  folderId: z.string(),
})

const moveFolderSchema = z.object({
  folderId: z.string(),
  targetParentId: z.string().nullable(),
})

const copyFolderSchema = z.object({
  sourceFolderId: z.string(),
  targetParentId: z.string().nullable(),
  newName: z.string().optional(),
})

const renameFolderSchema = z.object({
  folderId: z.string(),
  newName: z.string().min(1),
})

const mergeFolderSchema = z.object({
  sourceFolderId: z.string(),
  targetFolderId: z.string(),
})

const folderPathSchema = z.object({
  path: z.string(),
})

const validateNameSchema = z.object({
  name: z.string(),
  parentId: z.string().nullable(),
  excludeId: z.string().optional(),
})

const searchFoldersSchema = z.object({
  query: z.string().min(1),
  parentId: z.string().nullable().optional(),
  limit: z.number().min(1).max(100).default(20),
})

export const folderRouter = createTRPCRouter({
  // Query Procedures

  /** Get all folders in organization */
  list: permissionProcedure(PermissionKey.filesView).query(async ({ ctx }) => {
    try {
      const result = unwrap(await listFolders(toFilesCtx(ctx)))

      logger.info('Folders listed successfully', {
        count: result.items.length,
        total: result.total,
      })

      return result.items
    } catch (error) {
      logger.error('Failed to list folders', { error })
      rethrow(error, 'Failed to list folders')
    }
  }),

  /** Get folder by ID with relations */
  getById: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // `getFolderWithRelations`, not a `getById` — the latter has never
        // existed, so this procedure threw `TypeError` for every caller until
        // 2026-07-31.
        const folder = unwrap(await getFolderWithRelations(toFilesCtx(ctx), input.folderId))

        if (!folder) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Folder not found',
          })
        }

        logger.info('Folder retrieved successfully', { folderId: input.folderId })
        return folder
      } catch (error) {
        logger.error('Failed to get folder', { error, input })
        rethrow(error, 'Failed to get folder')
      }
    }),

  /** Get complete folder tree */
  getTree: permissionProcedure(PermissionKey.filesView).query(async ({ ctx }) => {
    try {
      // Two statements for the whole org. The legacy builder eagerly loaded the
      // `files` and `children` relations of every folder to compute counts it
      // then read off a Prisma `_count` field Drizzle never produces, so every
      // `fileCount` and `totalSize` in the tree was `0`.
      const tree = unwrap(await getFolderTree(toFilesCtx(ctx)))

      logger.info('Folder tree retrieved successfully', { nodeCount: tree.length })

      return tree
    } catch (error) {
      logger.error('Failed to get folder tree', { error })
      rethrow(error, 'Failed to get folder tree')
    }
  }),

  /** Get immediate subfolders */
  getSubfolders: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const subfolders = unwrap(await getSubfolders(toFilesCtx(ctx), input.folderId))

        logger.info('Subfolders retrieved successfully', {
          folderId: input.folderId,
          count: subfolders.length,
        })

        return subfolders
      } catch (error) {
        logger.error('Failed to get subfolders', { error, input })
        rethrow(error, 'Failed to get subfolders')
      }
    }),

  /** Get folder's ancestor chain */
  getAncestors: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const ancestors = unwrap(await getFolderAncestors(toFilesCtx(ctx), input.folderId))

        logger.info('Folder ancestors retrieved successfully', {
          folderId: input.folderId,
          ancestorCount: ancestors.length,
        })

        return ancestors
      } catch (error) {
        logger.error('Failed to get folder ancestors', { error, input })
        rethrow(error, 'Failed to get ancestors')
      }
    }),

  /** Get all descendant folders */
  getDescendants: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const descendants = unwrap(await getFolderDescendants(toFilesCtx(ctx), input.folderId))

        logger.info('Folder descendants retrieved successfully', {
          folderId: input.folderId,
          descendantCount: descendants.length,
        })

        return descendants
      } catch (error) {
        logger.error('Failed to get folder descendants', { error, input })
        rethrow(error, 'Failed to get descendants')
      }
    }),

  /** Search folders with relevance */
  search: permissionProcedure(PermissionKey.filesView)
    .input(searchFoldersSchema)
    .query(async ({ ctx, input }) => {
      try {
        // `SearchFoldersOptions` has no `parentId` — the query scores across the
        // whole org — so the parent filter is applied to the results here rather
        // than being passed in and silently ignored.
        const matches = unwrap(
          await searchFolders(toFilesCtx(ctx), input.query, { limit: input.limit })
        )
        const results =
          input.parentId === undefined
            ? matches
            : matches.filter((match) => match.folder.parentId === input.parentId)

        logger.info('Folder search completed', {
          query: input.query,
          resultCount: results.length,
        })

        return results
      } catch (error) {
        logger.error('Folder search failed', { error, input })
        rethrow(error, 'Search failed')
      }
    }),

  /** Get folder statistics */
  getStats: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // ONE call, not four. `FolderService.getStats()` took no arguments and
        // reported org-wide totals, so this procedure used to fan out to four
        // per-folder accessors in a `Promise.all` — and once PR 5d put
        // `getFolderCounts` behind all four, that `Promise.all` ran the same
        // pair of statements four times over for one panel (5a's
        // `getDownloadUrls` trap in miniature, named in plan §5.5). The four
        // numbers ARE `getFolderCounts`' return shape, so the output is
        // byte-identical.
        const stats = unwrap(await getFolderCounts(toFilesCtx(ctx), input.folderId))

        logger.info('Folder stats retrieved successfully', {
          folderId: input.folderId,
          stats,
        })

        return stats
      } catch (error) {
        logger.error('Failed to get folder stats', { error, input })
        rethrow(error, 'Failed to get stats')
      }
    }),

  /** Get folder usage analytics */
  getUsage: permissionProcedure(PermissionKey.filesView)
    .input(folderIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const usage = unwrap(await getFolderUsage(toFilesCtx(ctx), input.folderId))

        logger.info('Folder usage retrieved successfully', {
          folderId: input.folderId,
          usage,
        })

        return usage
      } catch (error) {
        logger.error('Failed to get folder usage', { error, input })
        rethrow(error, 'Failed to get usage')
      }
    }),

  /** Validate folder name uniqueness */
  validateName: permissionProcedure(PermissionKey.filesView)
    .input(validateNameSchema)
    .query(async ({ ctx, input }) => {
      try {
        const isValid = unwrap(
          await isFolderNameAvailable(toFilesCtx(ctx), input.name, input.parentId, input.excludeId)
        )

        logger.info('Folder name validation completed', {
          name: input.name,
          isValid,
        })

        return { isValid }
      } catch (error) {
        logger.error('Failed to validate folder name', { error, input })
        rethrow(error, 'Failed to validate name')
      }
    }),

  // Mutation Procedures

  /** Create new folder */
  create: permissionProcedure(PermissionKey.filesManage)
    .input(createFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // A single `INSERT`, so no transaction is opened. `organizationId` comes
        // from `ctx` and is no longer accepted from the caller: the legacy
        // `processCreateData` read `data.organizationId || this.requireOrganization()`,
        // so a request could name an organization it was not acting for.
        const folder = unwrap(
          await createFolder(
            toFilesCtx(ctx),
            {
              name: input.name,
              parentId: input.parentId,
              createdById: ctx.session.userId,
            },
            toFilesWriteDeps()
          )
        )

        logger.info('Folder created successfully', {
          folderId: folder.id,
          name: input.name,
          parentId: input.parentId,
        })

        return folder
      } catch (error) {
        logger.error('Failed to create folder', { error, input })
        rethrow(error, 'Failed to create folder')
      }
    }),

  /** Update folder properties */
  update: permissionProcedure(PermissionKey.filesManage)
    .input(updateFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // `UpdateFolderInput.parentId` is `?: string | null`, so the distinction
        // this procedure depends on is now expressible: `undefined` leaves the
        // parent alone, `null` moves the folder to the root. The legacy
        // `UpdateFolderRequest` declared `?: string` and the router carried a
        // note about the gap.
        const filesCtx = toFilesCtx(ctx)
        const folder = await ctx.db.transaction(async (tx) =>
          unwrap(
            await updateFolder(
              tx,
              filesCtx,
              input.folderId,
              { name: input.name, parentId: input.parentId },
              toFilesWriteDeps()
            )
          )
        )

        logger.info('Folder updated successfully', {
          folderId: input.folderId,
          updates: { name: input.name, parentId: input.parentId },
        })

        return folder
      } catch (error) {
        logger.error('Failed to update folder', { error, input })
        rethrow(error, 'Failed to update folder')
      }
    }),

  /** Soft delete folder and contents */
  delete: permissionProcedure(PermissionKey.filesManage)
    .input(folderIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // The subtree and its files go in two statements, inside one
        // transaction. Membership is `folderId IN (subtree)`: the legacy
        // cascade matched `ilike(FolderFile.path, '<path>%')` with no trailing
        // slash, so deleting `/Doc` soft-deleted everything under `/Documents`.
        const filesCtx = toFilesCtx(ctx)
        await ctx.db.transaction(async (tx) =>
          unwrap(await deleteFolder(tx, filesCtx, input.folderId, toFilesWriteDeps()))
        )

        logger.info('Folder deleted successfully', { folderId: input.folderId })
        return { success: true }
      } catch (error) {
        logger.error('Failed to delete folder', { error, input })
        rethrow(error, 'Failed to delete folder')
      }
    }),

  /** Restore soft-deleted folder */
  restore: permissionProcedure(PermissionKey.filesManage)
    .input(folderIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const folder = await ctx.db.transaction(async (tx) =>
          unwrap(await restoreFolder(tx, filesCtx, input.folderId, toFilesWriteDeps()))
        )

        logger.info('Folder restored successfully', { folderId: input.folderId })
        return folder
      } catch (error) {
        logger.error('Failed to restore folder', { error, input })
        rethrow(error, 'Failed to restore folder')
      }
    }),

  /** Permanently delete folder */
  permanentDelete: permissionProcedure(PermissionKey.filesManage)
    .input(folderIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        await ctx.db.transaction(async (tx) =>
          unwrap(await permanentlyDeleteFolder(tx, filesCtx, input.folderId))
        )

        logger.info('Folder permanently deleted', { folderId: input.folderId })
        return { success: true }
      } catch (error) {
        logger.error('Failed to permanently delete folder', { error, input })
        rethrow(error, 'Failed to permanently delete folder')
      }
    }),

  /** Move folder to new parent */
  move: permissionProcedure(PermissionKey.filesManage)
    .input(moveFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const folder = await ctx.db.transaction(async (tx) =>
          unwrap(
            await moveFolder(tx, filesCtx, input.folderId, input.targetParentId, toFilesWriteDeps())
          )
        )

        logger.info('Folder moved successfully', {
          folderId: input.folderId,
          targetParentId: input.targetParentId,
        })

        return folder
      } catch (error) {
        logger.error('Failed to move folder', { error, input })
        rethrow(error, 'Failed to move folder')
      }
    }),

  /** Rename folder */
  rename: permissionProcedure(PermissionKey.filesManage)
    .input(renameFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const folder = await ctx.db.transaction(async (tx) =>
          unwrap(
            await renameFolder(tx, filesCtx, input.folderId, input.newName, toFilesWriteDeps())
          )
        )

        logger.info('Folder renamed successfully', {
          folderId: input.folderId,
          newName: input.newName,
        })

        return folder
      } catch (error) {
        logger.error('Failed to rename folder', { error, input })
        rethrow(error, 'Failed to rename folder')
      }
    }),

  /** Copy folder with all contents */
  copy: permissionProcedure(PermissionKey.filesManage)
    .input(copyFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        const newFolder = await ctx.db.transaction(async (tx) =>
          unwrap(
            await copyFolder(
              tx,
              filesCtx,
              {
                sourceId: input.sourceFolderId,
                targetParentId: input.targetParentId,
                newName: input.newName,
                createdById: ctx.session.userId,
              },
              folderCopyDeps(tx, filesCtx)
            )
          )
        )

        logger.info('Folder copied successfully', {
          sourceFolderId: input.sourceFolderId,
          targetParentId: input.targetParentId,
          newFolderId: newFolder.id,
        })

        return newFolder
      } catch (error) {
        logger.error('Failed to copy folder', { error, input })
        rethrow(error, 'Failed to copy folder')
      }
    }),

  /**
   * Merge two folders.
   *
   * Resolves to `undefined`, which is what it has always done — the legacy
   * `FolderService.merge` returned `Promise<void>` while this procedure did
   * `const folder = await …; return folder`. `mergeFolders` returns void too, so
   * the output shape is unchanged; nothing calls this procedure, and inventing a
   * return value would be a product decision, not a refactor one.
   */
  merge: permissionProcedure(PermissionKey.filesManage)
    .input(mergeFolderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const filesCtx = toFilesCtx(ctx)
        await ctx.db.transaction(async (tx) =>
          unwrap(
            await mergeFolders(
              tx,
              filesCtx,
              input.sourceFolderId,
              input.targetFolderId,
              toFilesWriteDeps()
            )
          )
        )

        logger.info('Folders merged successfully', {
          sourceFolderId: input.sourceFolderId,
          targetFolderId: input.targetFolderId,
        })
      } catch (error) {
        logger.error('Failed to merge folders', { error, input })
        rethrow(error, 'Failed to merge folders')
      }
    }),

  /** Create folder path if not exists */
  ensurePath: permissionProcedure(PermissionKey.filesManage)
    .input(folderPathSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Deliberately not in a transaction, matching the legacy `ensurePath`:
        // the creates are independent and a partially-created path is a valid
        // state that a repeat call completes.
        const folder = unwrap(
          await ensureFolderPath(toFilesCtx(ctx), input.path, toFilesWriteDeps(), {
            createdById: ctx.session.userId,
          })
        )

        logger.info('Folder path ensured successfully', {
          path: input.path,
          folderId: folder.id,
        })

        return folder
      } catch (error) {
        logger.error('Failed to ensure folder path', { error, input })
        rethrow(error, 'Failed to ensure path')
      }
    }),
})
