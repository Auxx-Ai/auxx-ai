// packages/lib/src/files/file-upload/validators.ts

import path from 'path'
import { createScopedLogger } from '@auxx/logger'
import type { FileValidationOptions } from './types'
import { FileValidationError } from './types'

const logger = createScopedLogger('file-validators')

/**
 * Validate file size
 */
export function validateFileSize(size: number, maxSize?: number): void {
  // Default max size: 50MB
  const limit = maxSize || 50 * 1024 * 1024

  if (size > limit) {
    const sizeMB = Math.round(size / 1024 / 1024)
    const limitMB = Math.round(limit / 1024 / 1024)
    throw new FileValidationError(
      `File size ${sizeMB}MB exceeds maximum allowed size of ${limitMB}MB`,
      'FILE_TOO_LARGE'
    )
  }
}

/**
 * Validate file MIME type
 */
export function validateMimeType(mimeType: string, allowedTypes?: string[]): void {
  if (!allowedTypes || allowedTypes.length === 0) {
    // If no specific types are required, allow common safe types
    const defaultAllowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'text/csv',
      'text/x-markdown',
      'text/markdown',
      'application/json',
      'application/xml',
      'application/zip',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    allowedTypes = defaultAllowedTypes
  }

  const isAllowed = allowedTypes.some((allowed) => {
    // Support wildcard patterns like 'image/*'
    if (allowed.endsWith('/*')) {
      const prefix = allowed.slice(0, -2)
      return mimeType.startsWith(prefix + '/')
    }
    return mimeType === allowed
  })

  if (!isAllowed) {
    throw new FileValidationError(`File type ${mimeType} is not allowed`, 'INVALID_FILE_TYPE')
  }
}

/**
 * Validate file extension
 */
export function validateExtension(filename: string, allowedExtensions?: string[]): void {
  if (!allowedExtensions || allowedExtensions.length === 0) {
    return // No extension validation required
  }

  const ext = path.extname(filename).toLowerCase()

  if (!allowedExtensions.includes(ext)) {
    throw new FileValidationError(`File extension ${ext} is not allowed`, 'INVALID_FILE_EXTENSION')
  }
}

/**
 * Validate filename for security issues
 */
export function validateFilename(filename: string): void {
  // Remove any path components
  const basename = path.basename(filename)

  // Check for dangerous patterns
  const dangerousPatterns = [
    /\.\./, // Directory traversal
    /[<>:"|?*]/, // Invalid Windows characters
    /^\./, // Hidden files
    /[\x00-\x1f\x7f]/, // Control characters
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(basename)) {
      throw new FileValidationError('Filename contains invalid characters', 'INVALID_FILENAME')
    }
  }

  // Check filename length
  if (basename.length > 255) {
    throw new FileValidationError('Filename is too long', 'FILENAME_TOO_LONG')
  }
}

/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  let sanitized = path.basename(filename)

  // Replace spaces with underscores
  sanitized = sanitized.replace(/\s+/g, '_')

  // Remove or replace dangerous characters
  sanitized = sanitized.replace(/[<>:"|?*]/g, '')

  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '')

  // Ensure it doesn't start with a dot
  if (sanitized.startsWith('.')) {
    sanitized = sanitized.substring(1)
  }

  // Truncate if too long, preserving extension
  if (sanitized.length > 255) {
    const ext = path.extname(sanitized)
    const nameWithoutExt = sanitized.slice(0, -ext.length)
    sanitized = nameWithoutExt.slice(0, 255 - ext.length) + ext
  }

  return sanitized || 'unnamed'
}

/**
 * Comprehensive file validation
 */
export async function validateFile(
  file: { size: number; name: string; type?: string },
  options: FileValidationOptions
): Promise<void> {
  logger.info(`Validating file: ${file.name}`)

  // Validate filename
  validateFilename(file.name)

  // Validate size
  validateFileSize(file.size, options.maxSize)

  // Validate MIME type if provided
  if (file.type) {
    validateMimeType(file.type, options.allowedMimeTypes)
  }

  // Validate extension
  validateExtension(file.name, options.allowedExtensions)

  // TODO: Implement virus scanning if enabled
  if (options.scanForViruses) {
    logger.warn('Virus scanning requested but not yet implemented')
  }

  logger.info(`File validation passed: ${file.name}`)
}

/**
 * Get MIME type from file extension if not provided
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase()

  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/x-markdown',
    '.markdown': 'text/x-markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  }

  return mimeTypes[ext] || 'application/octet-stream'
}
