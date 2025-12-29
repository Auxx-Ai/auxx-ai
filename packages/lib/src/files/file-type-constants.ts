// packages/lib/src/files/file-type-constants.ts

/**
 * Standard file extension sets organized by category
 * Based on common file upload patterns
 */

/** Image file extensions */
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.svg',
  '.bmp',
  '.ico',
] as const

/** Video file extensions */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mpeg', '.webm', '.avi', '.mkv'] as const

/** Audio file extensions */
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.amr', '.mpga', '.ogg', '.flac'] as const

/** Document file extensions */
export const DOCUMENT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
] as const

/** File type category enum */
export const FILE_TYPE_CATEGORIES = ['image', 'document', 'video', 'audio', 'custom'] as const

/** File type category type */
export type FileTypeCategory = (typeof FILE_TYPE_CATEGORIES)[number]

/** Maps category to extensions */
export const CATEGORY_EXTENSIONS: Record<Exclude<FileTypeCategory, 'custom'>, readonly string[]> = {
  image: IMAGE_EXTENSIONS,
  document: DOCUMENT_EXTENSIONS,
  video: VIDEO_EXTENSIONS,
  audio: AUDIO_EXTENSIONS,
}

/** Maps category to MIME type patterns for client-side filtering */
export const CATEGORY_MIME_PATTERNS: Record<Exclude<FileTypeCategory, 'custom'>, string[]> = {
  image: ['image/*'],
  document: [
    'text/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.*',
    'application/json',
    'application/xml',
  ],
  video: ['video/*'],
  audio: ['audio/*'],
}

/**
 * Get all extensions for selected categories
 * @param categories - Array of file type categories
 * @param customExtensions - Custom extensions when 'custom' is included
 * @returns Array of file extensions (deduplicated)
 */
export function getExtensionsForCategories(
  categories: FileTypeCategory[],
  customExtensions: string[] = []
): string[] {
  const extensions: string[] = []
  for (const cat of categories) {
    if (cat === 'custom') {
      extensions.push(...customExtensions)
    } else {
      extensions.push(...CATEGORY_EXTENSIONS[cat])
    }
  }
  return Array.from(new Set(extensions))
}

/**
 * Get MIME patterns for selected categories (for input accept attribute)
 * @param categories - Array of file type categories
 * @param customExtensions - Custom extensions when 'custom' is included
 * @returns Array of MIME patterns and extensions for accept attribute
 */
export function getMimePatternsForCategories(
  categories: FileTypeCategory[],
  customExtensions: string[] = []
): string[] {
  const patterns: string[] = []
  for (const cat of categories) {
    if (cat === 'custom') {
      // For custom, use the extensions directly as accept values
      patterns.push(...customExtensions)
    } else {
      patterns.push(...CATEGORY_MIME_PATTERNS[cat])
    }
  }
  return Array.from(new Set(patterns))
}

/**
 * Check if a file extension is allowed based on categories
 * @param extension - File extension to check (e.g., '.pdf')
 * @param allowedCategories - Array of allowed categories
 * @param customExtensions - Custom extensions when 'custom' is included
 * @returns True if the extension is allowed
 */
export function isExtensionAllowed(
  extension: string,
  allowedCategories: FileTypeCategory[],
  customExtensions: string[] = []
): boolean {
  const normalizedExt = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`
  const allowedExtensions = getExtensionsForCategories(allowedCategories, customExtensions)
  return allowedExtensions.length === 0 || allowedExtensions.includes(normalizedExt)
}
