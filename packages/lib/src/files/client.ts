// packages/lib/src/files/client.ts

/**
 * Client-safe exports for file utilities
 * These can be safely imported in frontend code
 */

export {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  FILE_TYPE_CATEGORIES,
  CATEGORY_EXTENSIONS,
  CATEGORY_MIME_PATTERNS,
  getExtensionsForCategories,
  getMimePatternsForCategories,
  isExtensionAllowed,
  type FileTypeCategory,
} from './file-type-constants'
