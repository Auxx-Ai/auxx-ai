// packages/lib/src/files/lifecycle/quota-cleanup.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { StorageQuota } from './types'

const logger = createScopedLogger('quota-cleanup')

// Default storage quotas by organization type (in bytes)
const DEFAULT_QUOTAS = {
  free: 1 * 1024 * 1024 * 1024, // 1 GB
  starter: 10 * 1024 * 1024 * 1024, // 10 GB
  professional: 50 * 1024 * 1024 * 1024, // 50 GB
  enterprise: 500 * 1024 * 1024 * 1024, // 500 GB
}

/**
 * Calculate storage usage for an organization
 */
export async function calculateStorageUsage(organizationId: string): Promise<StorageQuota> {
  // Get total file size for the organization
  const [result] = await db
    .select({
      totalSize: sql<number>`sum(${schema.FileVersion.size})`,
      count: sql<number>`count(*)`,
    })
    .from(schema.FileVersion)
    .leftJoin(schema.File, eq(schema.FileVersion.fileId, schema.File.id))
    .where(and(eq(schema.File.organizationId, organizationId), isNull(schema.File.deletedAt)))

  const totalUsed = result.totalSize || 0
  const fileCount = result.count || 0

  // Get organization's quota limit (would need to be added to Organization model)
  // For now, using a default
  const quotaLimit = DEFAULT_QUOTAS.professional

  return {
    organizationId,
    totalUsed,
    quotaLimit,
    percentUsed: Math.round((totalUsed / quotaLimit) * 100),
    fileCount,
  }
}

/**
 * Job to check and enforce storage quotas
 * Runs daily to notify organizations approaching their limits
 */
export async function storageQuotaCheckJob(
  job: Job<{ dryRun?: boolean }>
): Promise<{ checked: number; warnings: number; enforced: number }> {
  const { dryRun = false } = job.data
  const result = {
    checked: 0,
    warnings: 0,
    enforced: 0,
  }

  try {
    logger.info('Starting storage quota check')

    // Get all organizations
    const organizations = await db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        // Add plan/tier field when available
      })
      .from(schema.Organization)

    for (const org of organizations) {
      result.checked++

      const usage = await calculateStorageUsage(org.id)

      // Check if over quota
      if (usage.percentUsed >= 100) {
        logger.warn('Organization over storage quota', {
          organizationId: org.id,
          name: org.name,
          percentUsed: usage.percentUsed,
          totalUsed: usage.totalUsed,
          quotaLimit: usage.quotaLimit,
        })

        if (!dryRun) {
          // TODO: Implement quota enforcement
          // - Prevent new uploads
          // - Send notification email
          // - Create system notification
          result.enforced++
        }
      } else if (usage.percentUsed >= 80) {
        // Warning threshold at 80%
        logger.info('Organization approaching storage quota', {
          organizationId: org.id,
          name: org.name,
          percentUsed: usage.percentUsed,
        })

        if (!dryRun) {
          // TODO: Send warning notification
          result.warnings++
        }
      }

      // Update job progress
      await job.updateProgress(Math.floor((result.checked / organizations.length) * 100))
    }

    logger.info('Storage quota check completed', result)
    return result
  } catch (error) {
    logger.error('Storage quota check failed', { error })
    throw error
  }
}

/**
 * Clean up files for organizations over quota
 * Prioritizes old, large, or unused files
 */
export async function quotaEnforcementCleanupJob(
  job: Job<{ organizationId: string; targetSize: number; dryRun?: boolean }>
): Promise<{ deleted: number; freedBytes: number }> {
  const { organizationId, targetSize, dryRun = false } = job.data
  const result = {
    deleted: 0,
    freedBytes: 0,
  }

  try {
    logger.info('Starting quota enforcement cleanup', { organizationId, targetSize })

    // Find candidates for deletion (old, orphaned files first)
    const candidates = await db
      .select({
        id: schema.FolderFile.id,
        name: schema.FolderFile.name,
        size: schema.FolderFile.size,
        createdAt: schema.FolderFile.createdAt,
        currentVersion: {
          id: schema.FileVersion.id,
          size: schema.FileVersion.size,
          storageLocation: {
            id: schema.StorageLocation.id,
          },
        },
      })
      .from(schema.FolderFile)
      .leftJoin(schema.FileVersion, eq(schema.FolderFile.currentVersionId, schema.FileVersion.id))
      .leftJoin(
        schema.StorageLocation,
        eq(schema.FileVersion.storageLocationId, schema.StorageLocation.id)
      )
      .leftJoin(schema.Attachment, eq(schema.FolderFile.id, schema.Attachment.folderFileId))
      .where(
        and(
          eq(schema.FolderFile.organizationId, organizationId),
          isNull(schema.Attachment.id), // No attachment (orphaned)
          lt(schema.FolderFile.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        )
      )
      .orderBy(asc(schema.FolderFile.createdAt))

    // Delete files until we reach the target size
    for (const file of candidates) {
      if (result.freedBytes >= targetSize) {
        break
      }

      if (!dryRun) {
        try {
          // Soft delete the file
          await db
            .update(schema.FolderFile)
            .set({
              deletedAt: new Date(),
            })
            .where(eq(schema.FolderFile.id, file.id))

          result.deleted++
          result.freedBytes += file.currentVersion?.size || 0

          logger.info('Deleted file for quota enforcement', {
            fileId: file.id,
            name: file.name,
            size: file.size,
          })
        } catch (error) {
          logger.error('Failed to delete file for quota enforcement', {
            fileId: file.id,
            error,
          })
        }
      } else {
        // Dry run - just count
        result.deleted++
        result.freedBytes += file.currentVersion?.size || 0
      }
    }

    logger.info('Quota enforcement cleanup completed', result)
    return result
  } catch (error) {
    logger.error('Quota enforcement cleanup failed', { error })
    throw error
  }
}
