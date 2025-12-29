// apps/web/src/components/file-upload/utils/upload-helpers.ts

import type { UploadFile, QueueStats, EntityUploadConfig } from '@auxx/lib/files/types'
import { ENTITY_CONFIGS, getEntityConfig } from '@auxx/lib/files/types'
import { formatBytes, getFileExtension } from '@auxx/lib/utils'

/**
 * Utility functions for file upload processing and calculations
 */

// Removed: fileToFileInfo - not used

/**
 * Validate file against upload constraints
 */
export function validateFile(
  file: File,
  config: EntityUploadConfig['validation']
): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > config.maxFileSize) {
    return {
      valid: false,
      error: `File size (${formatBytes(file.size)}) exceeds maximum allowed size (${formatBytes(config.maxFileSize)})`,
    }
  }

  // Check file extension first (more reliable than MIME type detection)
  let extensionValid = true
  let extensionError = ''
  if (config.allowedExtensions && config.allowedExtensions.length > 0) {
    const extension = getFileExtension(file.name).toLowerCase()
    const isAllowedExtension = config.allowedExtensions
      .map((ext) => ext.toLowerCase())
      .includes(extension)

    if (!isAllowedExtension) {
      extensionValid = false
      extensionError = `File extension "${extension}" is not allowed`
    }
  }

  // Check file type (MIME type)
  let mimeTypeValid = true
  let mimeTypeError = ''
  if (config.allowedMimeTypes && config.allowedMimeTypes.length > 0) {
    const isAllowedType = config.allowedMimeTypes.some((type) => {
      // Handle the special case of '*/*' which means allow all types
      if (type === '*/*') {
        return true
      }
      if (type.endsWith('/*')) {
        const category = type.slice(0, -2)
        return file.type.startsWith(category)
      }
      return file.type === type
    })

    if (!isAllowedType) {
      mimeTypeValid = false
      mimeTypeError = `File type "${file.type}" is not allowed`
    }
  }

  // If both extension and MIME type are configured, allow if either passes
  // This handles cases where MIME type detection fails but extension is correct
  if (
    config.allowedExtensions &&
    config.allowedExtensions.length > 0 &&
    config.allowedMimeTypes &&
    config.allowedMimeTypes.length > 0
  ) {
    if (!extensionValid && !mimeTypeValid) {
      return { valid: false, error: `${extensionError} and ${mimeTypeError}` }
    }
  } else {
    // If only one validation method is configured, it must pass
    if (!extensionValid) {
      return { valid: false, error: extensionError }
    }
    if (!mimeTypeValid) {
      return { valid: false, error: mimeTypeError }
    }
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
    stats.totalBytes += file.size
    stats.uploadedBytes += Math.round((file.progress / 100) * file.size)
    totalProgress += file.progress

    switch (file.status) {
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
      case 'deleting':
        // Count deleting files as processing for stats purposes
        stats.processing++
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

/**
 * Entity-specific stage configurations
 */
export const ENTITY_STAGE_CONFIGS = ENTITY_CONFIGS

/**
 * Get stage configuration for entity type
 */
export const getStageConfig = getEntityConfig
