// apps/web/src/components/file-upload/utils/upload-helpers.ts

import type { EntityUploadConfig, QueueStats, UploadFile } from '@auxx/lib/files/client'
import { formatBytes } from '@auxx/utils/file'

/**
 * Utility functions for file upload processing and calculations
 */

// Removed: fileToFileInfo - not used

/**
 * Pre-flight a file against an entity's upload policy, in the browser.
 *
 * Deliberately the same two rules, in the same order, as `enforceUploadPolicy`
 * on the server (`packages/lib/src/files/storage/presign.ts`): a size ceiling
 * and a MIME allow-list where `type/subtype`, `type/*` and `*​/*` all match.
 * The config it judges comes from `ENTITY_CONFIGS`, which projects the same
 * `UPLOAD_POLICIES` table the server's handlers spread — so a file this
 * function refuses is a file the server would also have refused.
 *
 * There used to be a third rule here, an extension allow-list, with no server
 * counterpart at all. It could only ever refuse a file the server would take:
 * an `.mp4` was rejected for `ARTICLE` client-side while the server had already
 * dropped `video/*`, and a `.heic` iPhone capture typed as `image/heic` had to
 * be listed twice to survive. It is gone.
 */
export function validateFile(
  file: File,
  config: EntityUploadConfig['validation']
): { valid: boolean; error?: string } {
  if (file.size > config.maxFileSize) {
    return {
      valid: false,
      error: `File size (${formatBytes(file.size)}) exceeds maximum allowed size (${formatBytes(config.maxFileSize)})`,
    }
  }

  const isAllowedType = config.allowedMimeTypes.some((type) => {
    if (type === '*/*') return true
    if (type.endsWith('/*')) return file.type.startsWith(type.slice(0, -2))
    return file.type === type
  })

  if (!isAllowedType) {
    return { valid: false, error: `File type "${file.type}" is not allowed` }
  }

  return { valid: true }
}

/**
 * Calculate overall progress from stages or files
 */
export function calculateOverallProgress(items: Array<{ progress: number }>): number {
  if (items.length === 0) return 0

  const totalProgress = items.reduce((sum, item) => sum + item.progress, 0)
  return Math.round(totalProgress / items.length)
}

/**
 * Calculate queue statistics
 */
export function calculateQueueStats(files: UploadFile[]): QueueStats {
  const stats = {
    total: files.length,
    pending: 0,
    uploading: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    overallProgress: 0,
    estimatedTimeRemaining: undefined as number | undefined,
  }

  let totalProgress = 0

  files.forEach((file) => {
    const overallProgress = file.progress.overallProgress
    stats.totalBytes += file.size
    stats.uploadedBytes += Math.round((overallProgress / 100) * file.size)
    totalProgress += overallProgress

    switch (file.progress.status) {
      case 'pending':
        stats.pending++
        break
      case 'uploading':
        stats.uploading++
        break
      case 'processing':
        stats.processing++
        break
      case 'completed':
        stats.completed++
        break
      case 'failed':
      case 'cancelled':
        stats.failed++
        break
    }
  })

  stats.overallProgress = files.length > 0 ? Math.round(totalProgress / files.length) : 0

  return stats
}
