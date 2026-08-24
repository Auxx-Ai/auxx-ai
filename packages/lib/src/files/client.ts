// packages/lib/src/files/client.ts

/**
 * The only `@auxx/lib/files` entry point front-end code may import.
 *
 * Everything re-exported here is provably free of server dependencies — no
 * `@auxx/database`, no queue, no storage client — so importing it from a
 * `'use client'` component cannot drag a Node-only module into the browser
 * bundle. `@auxx/lib/files/types` is the server-side barrel for the same
 * declarations; front-end code goes through this file instead so that the
 * boundary is a single reviewable list rather than a per-import judgement call.
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
export type {
  EntityUploadConfig,
  EntityUploadPolicy,
  FileStatus,
  FileVisibility,
  StageConfig,
  ValidationConfig,
} from './types/entities'
export {
  ENTITY_CONFIGS,
  ENTITY_TYPES,
  type EntityType,
  getEntityConfig,
  UPLOAD_POLICIES,
} from './types/entities'
export type {
  CreateSessionOptions,
  FileInfo,
  SessionConfig,
  SessionInfo,
  SessionProgress,
  SessionStatus,
  UploadSessionOptions,
} from './types/sessions'
export type {
  BatchProgressCallback,
  BatchUploadResult,
  CompletionCallback,
  ErrorCallback,
  MultiFileProgress,
  ProcessingStage,
  ProgressCallback,
  QueueConfig,
  QueuedFile,
  QueueStats,
  ServerIdKind,
  StageStatus,
  UploadCallbacks,
  UploadFile,
  UploadProgress,
  UploadResult,
  UploadResultMetadata,
  UploadStatus,
} from './types/uploads'
