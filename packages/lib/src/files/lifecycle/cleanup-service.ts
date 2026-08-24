// packages/lib/src/files/lifecycle/cleanup-service.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, exists, not, sql } from 'drizzle-orm'
import { deleteAsset, findExpiredAssets } from '../assets'
import { purgeMediaAssets } from '../core/media-asset-purge'
import { findOrphanedFolderFiles } from '../folder-files'
import { createS3StoragePort } from '../storage/ports'
import { createThumbnailCleanupPort, deleteThumbnailsForSource } from '../thumbnails'
import type { AttachmentIntegrityReport } from './attachment-maintenance'
import {
  validateAttachmentIntegrity as auditAttachmentIntegrity,
  cleanupOrphanedAttachments as sweepOrphanedAttachments,
} from './attachment-maintenance'

const logger = createScopedLogger('file-cleanup-utils')

/**
 * Options for deleting files
 */
export interface DeleteFilesOptions {
  deleteFromStorage?: boolean
  deleteFromDatabase?: boolean
  markAsDeleted?: boolean // Soft delete
}

/**
 * Delete all files associated with an entity
 */
export async function deleteEntityFiles(
  entityId: string,
  entityType: string,
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  const { deleteFromStorage = true, deleteFromDatabase = true, markAsDeleted = false } = options

  logger.info(`Deleting files for ${entityType}:${entityId}`)

  try {
    // Find all attachments for the entity

    const attachments = await database.query.Attachment.findMany({
      where: (attachments, { eq, and }) =>
        and(eq(attachments.entityId, entityId), eq(attachments.entityType, entityType)),
      with: {
        file: {
          with: {
            currentVersion: {
              with: {
                storageLocation: true,
              },
            },
          },
        },
        asset: {
          with: {
            currentVersion: {
              with: {
                storageLocation: true,
              },
            },
          },
        },
      },
    })

    logger.info(`Found ${attachments.length} attachments to delete`)

    const results = {
      deleted: 0,
      failed: 0,
      errors: [] as Error[],
    }

    // Process each attachment
    for (const attachment of attachments) {
      try {
        const file = attachment.file
        const asset = attachment.asset
        const item = file || asset

        if (!item) continue

        // Delete from storage first
        if (deleteFromStorage && item.currentVersion?.storageLocation) {
          try {
            const { StorageManager } = await import('../storage/storage-manager')
            const storageManager = new StorageManager(item.organizationId)
            await storageManager.deleteFile(item.currentVersion.storageLocation.id)
            logger.info(`Deleted ${file ? 'file' : 'asset'} from storage: ${item.id}`)
          } catch (storageError: any) {
            // Log but continue - file might already be deleted from storage
            logger.warn(`Failed to delete from storage: ${item.id}`, storageError)
            results.errors.push(storageError)
          }
        }

        // Update database
        if (deleteFromDatabase && !markAsDeleted) {
          // Hard delete
          if (file) {
            await database.delete(schema.FolderFile).where(eq(schema.FolderFile.id, file.id))
          } else if (asset) {
            // Thumbnails are separate MediaAssets referencing this one through
            // `derivedFromVersionId` (NO ACTION), so a bare delete raises 23503. Drop
            // their S3 objects first, then purge the whole closure in one statement.
            if (deleteFromStorage) await cleanupAssetThumbnails(asset.id)
            await purgeMediaAssets(database, [asset.id])
          }
          logger.info(`Deleted ${file ? 'file' : 'asset'} record: ${item.id}`)
        } else if (markAsDeleted) {
          // Soft delete
          if (file) {
            await database
              .update(schema.FolderFile)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(schema.FolderFile.id, file.id))
          } else if (asset) {
            await database
              .update(schema.MediaAsset)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(schema.MediaAsset.id, asset.id))
          }
          logger.info(`Marked ${file ? 'file' : 'asset'} as deleted: ${item.id}`)
        }

        results.deleted++
      } catch (error: any) {
        const itemId = attachment.file?.id || attachment.asset?.id || 'unknown'
        logger.error(`Failed to delete attachment ${itemId}:`, error)
        results.failed++
        results.errors.push(error)
      }
    }

    return results
  } catch (error) {
    logger.error('Failed to fetch files for deletion:', error)
    throw error
  }
}

/**
 * Delete files by their IDs
 */
export async function deleteFilesByIds(
  fileIds: string[],
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  const { deleteFromStorage = true, deleteFromDatabase = true, markAsDeleted = false } = options

  logger.info(`Deleting ${fileIds.length} files by ID`)

  const results = {
    deleted: 0,
    failed: 0,
    errors: [] as Error[],
  }

  // Fetch all files first
  const files = await database.query.FolderFile.findMany({
    where: (files, { inArray, isNull, and }) =>
      and(inArray(files.id, fileIds), isNull(files.deletedAt)),
    with: {
      currentVersion: {
        with: {
          storageLocation: true,
        },
      },
    },
  })

  for (const file of files) {
    try {
      if (deleteFromStorage && file.currentVersion?.storageLocation) {
        try {
          const { StorageManager } = await import('../storage/storage-manager')
          const storageManager = new StorageManager(file.organizationId)
          await storageManager.deleteFile(file.currentVersion.storageLocation.id)
          logger.info(`Deleted file from storage: ${file.id}`)
        } catch (storageError: any) {
          logger.warn(`Failed to delete from storage: ${file.id}`, storageError)
          results.errors.push(storageError)
        }
      }

      if (deleteFromDatabase && !markAsDeleted) {
        await database.delete(schema.FolderFile).where(eq(schema.FolderFile.id, file.id))
      } else if (markAsDeleted) {
        await database
          .update(schema.FolderFile)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.FolderFile.id, file.id))
      }

      results.deleted++
    } catch (error: any) {
      logger.error(`Failed to delete file ${file.id}:`, error)
      results.failed++
      results.errors.push(error)
    }
  }

  return results
}

/**
 * Delete all files for an organization
 * WARNING: This is a destructive operation!
 */
export async function deleteOrganizationFiles(
  organizationId: string,
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  logger.warn(`Deleting ALL files for organization: ${organizationId}`)

  const files = await database.query.FolderFile.findMany({
    where: (files, { eq, isNull, and }) =>
      and(eq(files.organizationId, organizationId), isNull(files.deletedAt)),
  })

  const fileIds = files.map((f: any) => f.id)
  return deleteFilesByIds(fileIds, options)
}

/**
 * Delete orphaned files (files with no entity association)
 */
export async function deleteOrphanedFiles(
  organizationId?: string,
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  logger.info('Deleting orphaned files')

  if (organizationId) {
    const orphaned = await findOrphanedFolderFiles({ db: database, organizationId })
    if (orphaned.isErr()) throw orphaned.error

    logger.info(`Found ${orphaned.value.length} orphaned files`)

    const fileIds = orphaned.value.map((f) => f.id)
    return deleteFilesByIds(fileIds, options)
  } else {
    // Fallback to DB query for cross-organization cleanup
    const files = await database.query.FolderFile.findMany({
      where: (files, { and, isNull }) =>
        and(
          isNull(files.deletedAt),
          not(
            exists(
              database
                .select({ one: sql`1` })
                .from(schema.Attachment)
                .where(eq(schema.Attachment.fileId, files.id))
            )
          )
        ),
    })

    logger.info(`Found ${files.length} orphaned files across all organizations`)

    const fileIds = files.map((f: any) => f.id)
    return deleteFilesByIds(fileIds, options)
  }
}

/**
 * Delete expired pending files and assets
 */
export async function deleteExpiredFiles(
  organizationId?: string,
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  logger.info('Deleting expired files and assets')

  let totalDeleted = 0
  let totalFailed = 0
  const allErrors: Error[] = []

  if (organizationId) {
    const ctx = { db: database, organizationId }
    // 24 hours. The cutoff is computed here rather than inside the query, so the
    // read never touches the clock itself.
    const createdBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const expired = await findExpiredAssets(ctx, createdBefore)
    if (expired.isErr()) throw expired.error
    const expiredAssets = expired.value

    logger.info(`Found ${expiredAssets.length} expired assets`)

    if (expiredAssets.length > 0) {
      const storage = createS3StoragePort(organizationId)
      // Note: deleteFilesByIds only handles files, we'd need a similar function for assets
      // For now, delete assets directly
      for (const asset of expiredAssets) {
        try {
          if (!options.markAsDeleted && options.deleteFromDatabase) {
            // One transaction per asset, matching the legacy per-asset
            // `MediaAssetService.delete` — a failure must not roll the whole
            // sweep back. `deleteAsset` takes a real `Transaction`, and every
            // nested read inside it runs on `tx`, never on the outer pool.
            await database.transaction(async (tx) => {
              const txCtx = { ...ctx, db: tx }
              const result = await deleteAsset(
                tx,
                txCtx,
                {
                  now: () => new Date(),
                  thumbnails: createThumbnailCleanupPort(txCtx, {
                    storage,
                    now: () => new Date(),
                  }),
                },
                asset.id
              )
              if (result.isErr()) throw result.error
            })
            totalDeleted++
          }
        } catch (error) {
          totalFailed++
          allErrors.push(error as Error)
        }
      }
    }

    // Find orphaned files older than 24 hours
    const expiredFiles = await database.query.FolderFile.findMany({
      where: (files, { eq, isNull, lte, and }) =>
        and(
          eq(files.organizationId, organizationId),
          not(
            exists(
              database
                .select({ one: sql`1` })
                .from(schema.Attachment)
                .where(eq(schema.Attachment.fileId, files.id))
            )
          ),
          lte(files.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          isNull(files.deletedAt)
        ),
    })

    logger.info(`Found ${expiredFiles.length} expired files`)

    if (expiredFiles.length > 0) {
      const fileIds = expiredFiles.map((f) => f.id)
      const fileResult = await deleteFilesByIds(fileIds, options)
      totalDeleted += fileResult.deleted
      totalFailed += fileResult.failed
      allErrors.push(...fileResult.errors)
    }
  } else {
    // Fallback to DB query for cross-organization cleanup
    const files = await database.query.FolderFile.findMany({
      where: (files, { lte, isNull, and }) =>
        and(
          lte(files.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          isNull(files.deletedAt)
        ),
      with: {
        attachments: true,
      },
    })

    logger.info(`Found ${files.length} expired files across all organizations`)

    // Filter out files that have attachments
    const orphanedFiles = files.filter((f) => !f.attachments || f.attachments.length === 0)
    const fileIds = orphanedFiles.map((f: any) => f.id)
    const result = await deleteFilesByIds(fileIds, options)
    totalDeleted = result.deleted
    totalFailed = result.failed
    allErrors.push(...result.errors)
  }

  return {
    deleted: totalDeleted,
    failed: totalFailed,
    errors: allErrors,
  }
}

/**
 * Clean up orphaned attachments.
 *
 * Thin `{ deleted, failed, errors }` adapter over
 * `lifecycle/attachment-maintenance.ts`, which holds the query. Kept in that
 * legacy shape because it is the shape every other sweep in this file reports.
 */
export async function cleanupOrphanedAttachments(
  organizationId: string
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  logger.info('Cleaning up orphaned attachments')

  const result = await sweepOrphanedAttachments({ db: database, organizationId })
  if (result.isErr()) {
    logger.error('Failed to cleanup orphaned attachments:', result.error)
    return { deleted: 0, failed: 1, errors: [result.error] }
  }

  logger.info(`Cleaned up ${result.value} orphaned attachments`)
  return { deleted: result.value, failed: 0, errors: [] }
}

/**
 * Validate attachment integrity.
 *
 * Adapter over `lifecycle/attachment-maintenance.ts`; throws the `AuxxError` the
 * sweep produced rather than swallowing it, matching the legacy body.
 */
export async function validateAttachmentIntegrity(
  organizationId: string
): Promise<AttachmentIntegrityReport> {
  logger.info('Validating attachment integrity')

  const result = await auditAttachmentIntegrity({ db: database, organizationId })
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * Clean up failed upload
 * Use this when an upload succeeds but subsequent processing fails
 */
export async function cleanupFailedUpload(
  storageLocationId: string,
  fileId?: string,
  organizationId?: string
): Promise<void> {
  logger.info(`Cleaning up failed upload: ${storageLocationId}`)

  if (organizationId) {
    try {
      // Delete from storage
      const { StorageManager } = await import('../storage/storage-manager')
      const storageLocation = await database.query.StorageLocation.findFirst({
        where: (locations, { eq }) => eq(locations.id, storageLocationId),
      })
      if (storageLocation) {
        const storageManager = new StorageManager(organizationId)
        await storageManager.deleteFile(storageLocation.id)
        logger.info('Deleted file from storage')
      }
    } catch (error) {
      logger.error('Failed to delete from storage:', error)
    }
  }

  // Delete from database if we have the ID
  if (fileId) {
    try {
      await database.delete(schema.FolderFile).where(eq(schema.FolderFile.id, fileId))
      logger.info('Deleted file record from database')
    } catch (error) {
      logger.error('Failed to delete from database:', error)
    }
  }
}

/**
 * Clean up thumbnails for deleted assets
 */
export async function cleanupAssetThumbnails(
  assetId: string,
  versionId?: string,
  options: DeleteFilesOptions = {}
): Promise<{ deleted: number; failed: number }> {
  logger.info('Cleaning up thumbnails for asset', { assetId, versionId })
  let deletedCount = 0

  try {
    // Get organization context with proper scoping
    const asset = await database.query.MediaAsset.findFirst({
      where: (assets, { eq }) => eq(assets.id, assetId),
      columns: { organizationId: true },
    })

    if (!asset) {
      logger.warn('Asset not found for thumbnail cleanup', { assetId })
      return { deleted: 0, failed: 0 }
    }

    // PR 5f: the sweep is a function taking `ctx` + a storage port, not a
    // service bound to the global `db` at construction.
    const ctx = { db: database, organizationId: asset.organizationId }
    const deps = {
      storage: createS3StoragePort(asset.organizationId),
      now: () => new Date(),
    }

    if (versionId) {
      // Clean up thumbnails for specific version
      const swept = await deleteThumbnailsForSource(ctx, deps, versionId)
      if (swept.isErr()) throw swept.error
      deletedCount = 1
    } else {
      // Clean up all thumbnails for the asset with organization scoping
      const versions = await database.query.MediaAssetVersion.findMany({
        where: (versions, { eq }) => eq(versions.assetId, assetId),
        columns: { id: true },
      })

      for (const version of versions) {
        const swept = await deleteThumbnailsForSource(ctx, deps, version.id)
        if (swept.isErr()) throw swept.error
        deletedCount++
      }
    }

    logger.info('Thumbnails cleanup completed', { assetId, deletedCount })
    return { deleted: deletedCount, failed: 0 }
  } catch (error) {
    logger.error('Failed to cleanup asset thumbnails', {
      assetId,
      versionId,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    return { deleted: deletedCount, failed: 1 }
  }
}
