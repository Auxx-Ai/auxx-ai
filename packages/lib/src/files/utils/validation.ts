// packages/lib/src/files/utils/validation.ts
import { formatBytes } from '@auxx/utils/file'
/**
 * Common validation utilities for file operations
 */

/**
 * Validate file name for safety and compatibility
 */
export function validateFileName(name: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!name || name.trim().length === 0) {
    errors.push('File name cannot be empty')
  }

  // Check length
  if (name.length > 255) {
    errors.push('File name cannot exceed 255 characters')
  }

  // Check for invalid characters
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/
  if (invalidChars.test(name)) {
    errors.push('File name contains invalid characters')
  }

  // Check for reserved names (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(name)) {
    errors.push('File name is reserved')
  }

  // Check for leading/trailing spaces or dots
  if (name !== name.trim()) {
    errors.push('File name cannot start or end with spaces')
  }

  if (name.endsWith('.')) {
    errors.push('File name cannot end with a dot')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate folder name for safety and compatibility
 */
export function validateFolderName(name: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!name || name.trim().length === 0) {
    errors.push('Folder name cannot be empty')
  }

  // Check length
  if (name.length > 255) {
    errors.push('Folder name cannot exceed 255 characters')
  }

  // Check for invalid characters
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/
  if (invalidChars.test(name)) {
    errors.push('Folder name contains invalid characters')
  }

  // Check for reserved names
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(name)) {
    errors.push('Folder name is reserved')
  }

  // Check for leading/trailing spaces or dots
  if (name !== name.trim()) {
    errors.push('Folder name cannot start or end with spaces')
  }

  if (name.endsWith('.')) {
    errors.push('Folder name cannot end with a dot')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate file size limits
 */
export function validateFileSize(
  size: bigint,
  limits: {
    maxSize?: bigint
    minSize?: bigint
  } = {}
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (limits.minSize && size < limits.minSize) {
    errors.push(`File size must be at least ${formatBytes(limits.minSize)}`)
  }

  if (limits.maxSize && size > limits.maxSize) {
    errors.push(`File size cannot exceed ${formatBytes(limits.maxSize)}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate MIME type against allowed types
 */
export function validateMimeType(
  mimeType: string | null,
  allowedTypes: string[] = []
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!mimeType) {
    errors.push('MIME type is required')
    return { isValid: false, errors }
  }

  if (allowedTypes.length > 0) {
    const isAllowed = allowedTypes.some((allowed) => {
      // Support wildcards like "image/*"
      if (allowed.endsWith('/*')) {
        const category = allowed.slice(0, -2)
        return mimeType.startsWith(category + '/')
      }
      return mimeType === allowed
    })

    if (!isAllowed) {
      errors.push(`MIME type ${mimeType} is not allowed`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate file extension against allowed extensions
 */
export function validateFileExtension(
  extension: string | null,
  allowedExtensions: string[] = []
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (allowedExtensions.length > 0) {
    if (!extension) {
      errors.push('File extension is required')
      return { isValid: false, errors }
    }

    const normalizedExt = extension.toLowerCase().replace(/^\./, '') // Remove leading dot
    const normalizedAllowed = allowedExtensions.map((ext) => ext.toLowerCase().replace(/^\./, ''))

    if (!normalizedAllowed.includes(normalizedExt)) {
      errors.push(`File extension .${normalizedExt} is not allowed`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Parse file size string to bytes
 */
export function parseFileSize(sizeStr: string): bigint | null {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i)
  if (!match) return null

  const [, numStr, unit] = match
  const num = parseFloat(numStr)

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  }

  const multiplier = multipliers[unit.toUpperCase()]
  if (!multiplier) return null

  return BigInt(Math.floor(num * multiplier))
}

/**
 * Sanitize file name by removing or replacing invalid characters
 */
export function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid chars with underscore
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, '_$1$2') // Handle reserved names
    .replace(/\.+$/, '') // Remove trailing dots
    .substring(0, 255) // Limit length
}

/**
 * Sanitize folder name by removing or replacing invalid characters
 */
export function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid chars with underscore
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, '_$1$2') // Handle reserved names
    .replace(/\.+$/, '') // Remove trailing dots
    .substring(0, 255) // Limit length
}

/**
 * Extract file extension from filename
 */
export function extractFileExtension(filename: string): string | null {
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return null
  }
  return filename.substring(lastDotIndex + 1).toLowerCase()
}

/**
 * Get MIME type from file extension (basic mapping)
 */
export function getMimeTypeFromExtension(extension: string): string | null {
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',

    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Text
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    xml: 'application/xml',

    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',

    // Video
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    webm: 'video/webm',
  }

  return mimeTypes[extension.toLowerCase()] || null
}
