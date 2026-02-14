// packages/lib/src/files/lifecycle/cleanup-service.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { createAttachmentService } from '../core/attachment-service'
import { createFileService } from '../core/file-service'
import { createMediaAssetService } from '../core/media-asset-service'
import { ThumbnailService } from '../core/thumbnail-service'

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
            const storageManager = new StorageManager(item.organizationId)
            await storageManager.deleteFile(item.currentVersion.storageLocation)
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
            await database.delete(schema.MediaAsset).where(eq(schema.MediaAsset.id, asset.id))
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
          const storageManager = new StorageManager(file.organizationId)
          await storageManager.deleteFile(file.currentVersion.storageLocation)
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
    // Use FileService to find orphaned files
    const fileService = createFileService(organizationId)
    const orphanedFiles = await fileService.findOrphanedFiles()

    logger.info(`Found ${orphanedFiles.length} orphaned files`)

    const fileIds = orphanedFiles.map((f) => f.id)
    return deleteFilesByIds(fileIds, options)
  } else {
    // Fallback to DB query for cross-organization cleanup
    const files = await database.query.FolderFile.findMany({
      where: (files, { isNull, and }) => and(isNull(files.attachment), isNull(files.deletedAt)),
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
    // Use services to find expired items
    const assetService = createMediaAssetService(organizationId)
    const expiredAssets = await assetService.findExpired(24) // 24 hours

    logger.info(`Found ${expiredAssets.length} expired assets`)

    if (expiredAssets.length > 0) {
      const assetIds = expiredAssets.map((a) => a.id)
      // Note: deleteFilesByIds only handles files, we'd need a similar function for assets
      // For now, delete assets directly
      for (const asset of expiredAssets) {
        try {
          if (!options.markAsDeleted && options.deleteFromDatabase) {
            await assetService.delete(asset.id)
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
          isNull(files.attachment),
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
 * Clean up orphaned attachments using AttachmentService
 */
export async function cleanupOrphanedAttachments(
  organizationId: string
): Promise<{ deleted: number; failed: number; errors: Error[] }> {
  logger.info('Cleaning up orphaned attachments')

  try {
    const attachmentService = createAttachmentService(organizationId)
    const deletedCount = await attachmentService.cleanupOrphanedAttachments()

    logger.info(`Cleaned up ${deletedCount} orphaned attachments`)

    return {
      deleted: deletedCount,
      failed: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('Failed to cleanup orphaned attachments:', error)
    return {
      deleted: 0,
      failed: 1,
      errors: [error as Error],
    }
  }
}

/**
 * Validate attachment integrity using AttachmentService
 */
export async function validateAttachmentIntegrity(organizationId: string): Promise<{
  validAttachments: number
  invalidAttachments: number
  errors: string[]
}> {
  logger.info('Validating attachment integrity')

  const attachmentService = createAttachmentService(organizationId)
  return await attachmentService.validateAttachmentIntegrity()
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
        await storageManager.deleteFile(storageLocation)
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

    const thumbnailService = new ThumbnailService(asset.organizationId, 'system', database)

    if (versionId) {
      // Clean up thumbnails for specific version
      await thumbnailService.deleteThumbnailsForSource(versionId)
      deletedCount = 1
    } else {
      // Clean up all thumbnails for the asset with organization scoping
      const versions = await database.query.MediaAssetVersion.findMany({
        where: (versions, { eq }) => eq(versions.assetId, assetId),
        columns: { id: true },
        with: {
          asset: {
            where: (assets, { eq }) => eq(assets.organizationId, asset.organizationId),
            columns: { organizationId: true },
          },
        },
      })

      for (const version of versions) {
        await thumbnailService.deleteThumbnailsForSource(version.id)
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
