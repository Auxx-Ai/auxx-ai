// packages/lib/src/files/lifecycle/index.ts

/**
 * Main cleanup orchestrator for file cleanup operations
 * Coordinates different cleanup strategies and provides a unified interface
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { calculateStorageUsage } from './quota-cleanup'

const logger = createScopedLogger('file-cleanup')

export {
  cleanupFailedUpload,
  deleteEntityFiles,
  deleteExpiredFiles,
  deleteFilesByIds,
  deleteOrganizationFiles,
  deleteOrphanedFiles,
} from './cleanup-service'
// Re-export all cleanup functions
export {
  deletedFileCleanupJob,
  orphanedFileCleanupJob,
} from './orphaned-cleanup'
export {
  calculateStorageUsage,
  quotaEnforcementCleanupJob,
  storageQuotaCheckJob,
} from './quota-cleanup'

// Re-export types
export type {
  CleanupStats,
  DeleteFilesOptions,
  OrphanedFileCleanupJobData,
  OrphanedFileCleanupResult,
  StorageQuota,
} from './types'

/**
 * Initialize file cleanup system
 * Sets up default expiration times for new files
 */
export function initializeFileCleanup() {
  logger.info('File cleanup system initialized')

  // Additional initialization if needed
  // e.g., register cleanup jobs, set up monitors, etc.
}

/**
 * Get cleanup statistics for an organization
 */
export async function getCleanupStats(organizationId: string): Promise<{
  orphanedFiles: number
  expiredFiles: number
  deletedFiles: number
  totalStorageUsed: number
  storageQuota: number
}> {
  // Count orphaned files (files without attachments)
  const orphanedFiles = await database
    .select({ count: count() })
    .from(schema.FolderFile)
    .leftJoin(schema.Attachment, eq(schema.Attachment.fileId, schema.FolderFile.id))
    .where(
      and(
        eq(schema.FolderFile.organizationId, organizationId),
        isNull(schema.Attachment.id),
        lt(schema.FolderFile.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)) // Older than 24 hours
      )
    )
    .then((result) => result[0]?.count ?? 0)

  // Count old unattached files (similar to expired)
  const expiredFiles = await database
    .select({ count: count() })
    .from(schema.FolderFile)
    .leftJoin(schema.Attachment, eq(schema.Attachment.fileId, schema.FolderFile.id))
    .where(
      and(
        eq(schema.FolderFile.organizationId, organizationId),
        isNull(schema.Attachment.id),
        lt(schema.FolderFile.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // Older than 7 days
        isNull(schema.FolderFile.deletedAt)
      )
    )
    .then((result) => result[0]?.count ?? 0)

  // Count soft-deleted files
  const deletedFiles = await database
    .select({ count: count() })
    .from(schema.FolderFile)
    .where(
      and(
        eq(schema.FolderFile.organizationId, organizationId),
        isNotNull(schema.FolderFile.deletedAt)
      )
    )
    .then((result) => result[0]?.count ?? 0)

  // Get storage usage
  const usage = await calculateStorageUsage(organizationId)

  return {
    orphanedFiles,
    expiredFiles,
    deletedFiles,
    totalStorageUsed: usage.totalUsed,
    storageQuota: usage.quotaLimit,
  }
}
