// packages/lib/src/files/lifecycle/orphaned-cleanup.ts

import type { Job } from 'bullmq'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { deleteFilesByIds, deleteExpiredFiles, cleanupOrphanedAttachments } from './cleanup-service'
import { createFileService } from '../core/file-service'
import { createMediaAssetService } from '../core/media-asset-service'
import type { OrphanedFileCleanupJobData, OrphanedFileCleanupResult } from './types'

// Scoped logger used across orphaned file cleanup routines
const logger = createScopedLogger('orphaned-file-cleanup')

/**
 * Job to clean up orphaned files that were uploaded but never attached to entities
 * Runs hourly to delete files where status = 'PENDING' and expiresAt < now
 */
export async function orphanedFileCleanupJob(
  job: Job<OrphanedFileCleanupJobData>
): Promise<OrphanedFileCleanupResult> {
  const { batchSize = 100, dryRun = false } = job.data
  const result: OrphanedFileCleanupResult = {
    processed: 0,
    deleted: 0,
    errors: 0,
    files: [],
  }

  try {
    logger.info('Starting orphaned file cleanup', { batchSize, dryRun })

    // Use the cleanup service utility for expired files (older than 24 hours without attachments)
    const cleanupResult = await deleteExpiredFiles(undefined, {
      deleteFromStorage: true,
      deleteFromDatabase: !dryRun,
      markAsDeleted: false,
    })

    // Also clean up orphaned attachments if not in dry run mode
    if (!dryRun) {
      try {
        // Note: This requires organization context, so we'll skip for global cleanup
        // In a real implementation, you'd want to iterate through organizations
        logger.info('Skipping orphaned attachment cleanup in global mode - requires organization context')
      } catch (error) {
        logger.warn('Failed to cleanup orphaned attachments:', error)
      }
    }

    result.processed = cleanupResult.deleted + cleanupResult.failed
    result.deleted = cleanupResult.deleted
    result.errors = cleanupResult.failed

    // Convert cleanup results to our result format
    // Note: cleanup-service doesn't return individual file details, so we'll log summary only
    logger.info(`Found and processed ${result.processed} orphaned files`)

    // Log summary
    logger.info('Orphaned file cleanup completed', {
      processed: result.processed,
      deleted: result.deleted,
      errors: result.errors,
      dryRun,
    })

    return result
  } catch (error) {
    logger.error('Orphaned file cleanup job failed', { error })
    throw error
  }
}

/**
 * Job to clean up soft-deleted files after retention period
 * Runs daily to permanently delete files where deletedAt < 30 days ago
 */
export async function deletedFileCleanupJob(
  job: Job<OrphanedFileCleanupJobData>
): Promise<OrphanedFileCleanupResult> {
  const { batchSize = 100, dryRun = false } = job.data
  const result: OrphanedFileCleanupResult = {
    processed: 0,
    deleted: 0,
    errors: 0,
    files: [],
  }

  try {
    logger.info('Starting soft-deleted file cleanup', { batchSize, dryRun })

    // Find soft-deleted files older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const deletedFiles = await db.query.FolderFile.findMany({
      where: (folderFiles, { lt }) => lt(folderFiles.deletedAt, thirtyDaysAgo),
      limit: batchSize,
      orderBy: (folderFiles, { asc }) => [asc(folderFiles.deletedAt)],
      columns: {
        id: true,
        name: true,
        organizationId: true,
        deletedAt: true,
      },
      with: {
        currentVersion: {
          columns: {
            size: true,
          },
        },
      },
    })

    logger.info(`Found ${deletedFiles.length} soft-deleted files to permanently delete`)

    if (deletedFiles.length > 0) {
      const fileIds = deletedFiles.map((f) => f.id)

      // Use cleanup service utility for bulk deletion
      const cleanupResult = await deleteFilesByIds(fileIds, {
        deleteFromStorage: true,
        deleteFromDatabase: !dryRun,
        markAsDeleted: false, // Permanently delete
      })

      result.processed = cleanupResult.deleted + cleanupResult.failed
      result.deleted = cleanupResult.deleted
      result.errors = cleanupResult.failed

      // Convert file details for result (limited info since cleanup service doesn't return details)
      result.files = deletedFiles.map((file) => ({
        id: file.id,
        name: file.name || 'Unknown',
        size: Number(file.currentVersion?.size ?? 0),
        status: 'deleted' as const, // Assume success if no errors thrown
      }))

      // Update job progress
      await job.updateProgress(100)
    }

    // Log summary
    logger.info('Soft-deleted file cleanup completed', {
      processed: result.processed,
      deleted: result.deleted,
      errors: result.errors,
      dryRun,
    })

    return result
  } catch (error) {
    logger.error('Deleted file cleanup job failed', { error })
    throw error
  }
}
