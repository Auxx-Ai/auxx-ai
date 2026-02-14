// packages/lib/src/files/client.ts

/**
 * Client-safe exports for file utilities
 * These can be safely imported in frontend code
 */

export {
  AUDIO_EXTENSIONS,
  CATEGORY_EXTENSIONS,
  CATEGORY_MIME_PATTERNS,
  DOCUMENT_EXTENSIONS,
  FILE_TYPE_CATEGORIES,
  type FileTypeCategory,
  getExtensionsForCategories,
  getMimePatternsForCategories,
  IMAGE_EXTENSIONS,
  isExtensionAllowed,
  VIDEO_EXTENSIONS,
} from './file-type-constants'
