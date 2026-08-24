// packages/lib/src/files/index.ts
/**
 * Main entry point for file services
 * Exports all public APIs for file management in the new organized structure
 */

// ============= CORE TYPES =============

// The service classes are GONE. `AttachmentService`, `BaseService`,
// `FileService`, `FilesystemService`, `FolderService`, `MediaAssetService` and
// `ThumbnailService` were all deleted across PRs 5a-5g -- every one of them is
// now a set of `db`-first functions under `files/assets/`, `files/attachments/`,
// `files/folder-files/`, `files/folders/`, `files/filesystem/` and
// `files/thumbnails/`, reached through `@auxx/lib/files/server`. Nothing is
// re-exported from this barrel in their place: the functions take a `FilesCtx`
// and belong on the server subpath, which is where every consumer already looks.
export type {
  GenerateThumbnailPayload,
  PresetConfig,
  PresetKey,
  ProcessedThumbnail,
  ThumbnailMetadata,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailServiceConfig,
  ThumbnailSet,
  ThumbnailSource,
} from './core/thumbnail-types'
export { ALLOWED_IMAGE_TYPES, THUMBNAIL_LIMITS, THUMBNAIL_PRESETS } from './core/thumbnail-types'
export type {
  AssetKind,
  AttachmentRole,
  CreateAssetRequest,
  CreateAttachmentRequest,
  CreateFileRequest,
  CreateFolderRequest,
  FolderTreeNode,
  UpdateAssetRequest,
  UpdateAttachmentRequest,
  UpdateFileRequest,
  UpdateFolderRequest,
} from './core/types'
// Remote image fetch → MediaAsset helper (shared by enrichment triggers and extension)
export type { FetchRemoteImageInput, FetchRemoteImageResult } from './fetch-remote-image'
export { assertPublicHost, fetchAndStoreRemoteImage } from './fetch-remote-image'

// Filesystem Service - Unified bulk loading operations

// ============= STORAGE SYSTEM =============

export type {
  FileMetadata,
  MultipartUpload,
  PresignedUpload,
  ProviderAuth,
  ProviderId,
  StorageAdapter,
  StorageAdapterError,
  StorageAuthError,
  StorageCapabilities,
  StorageFileNotFoundError,
  StorageLocationRef,
  StorageQuotaError,
  StorageUnsupportedError,
} from './adapters/base-adapter'
// Storage Adapters
export { BaseStorageAdapter } from './adapters/base-adapter'
export { S3Adapter } from './adapters/s3-adapter'
// NOTE: `StorageLocation` persistence is `storage/locations.ts` (writes) and
// `storage/location-queries.ts` (reads). Neither is re-exported here, matching
// every other module written to the `files/ctx.ts` contract: they are imported
// by path from the one or two call sites that need them, so the barrel does not
// grow a public surface nothing asked for.
export type { StorageDownloadParams } from './storage/storage-manager'
// Storage Manager - Unified storage operations
export { createStorageManager, StorageManager } from './storage/storage-manager'

// ============= UPLOAD SYSTEM =============

// NOTE: upload sessions are `upload/session.ts`. Not re-exported here — nothing
// outside `files/` imports them through this barrel, and `files/server.ts` is
// where the two route surfaces that do need them already look.

// Legacy Upload Types (for backward compatibility)
export type { FileUploadParams, FileUploadResult } from './upload/types'

// ============= LIFECYCLE MANAGEMENT =============

// Storage measurement. The three scheduled sweeps that act on it moved to
// `@auxx/lib/jobs` (`jobs/maintenance/file-cleanup-jobs.ts`) in plan 7c, so
// `files/lifecycle/` no longer binds the process-wide pool at module scope; the
// reapers it holds take a `Database` and a storage seam as parameters.
export {
  calculateStorageUsage,
  type StorageQuota,
} from './lifecycle/quota-cleanup'

// ============= SHARED TYPES & UTILITIES =============

// Shared types
// export type {
//   EntityType,
//   FileVisibility,
//   FileStatus,
//   ProcessingStage,
//   FileInfo,
//   SessionStatus,
//   SessionData,
// } from './shared-types'

// export {
//   ENTITY_TYPES as EntityTypeEnum,
//   FileUploadEventType,
//   FileUploadChannels,
// } from './shared-types'

export type { EntityType } from './types'
export { ENTITY_TYPES } from './types'
// The processor hierarchy was deleted in PR 4d; dispatch is the handler records
// in `upload/handlers/`, reached through `prepareUpload` / `completeUpload`.
// `ensureProcessorsInitialized` and `ProcessorRegistry` had no consumers outside
// the module they lived in.
// Validators
export {
  getMimeTypeFromExtension,
  sanitizeFilename,
  validateExtension,
  validateFile,
  validateFilename,
  validateFileSize,
  validateMimeType,
} from './upload/validators'

// Selected utilities re-exported for convenience
export {
  createFileDownloadResponse,
  encodeContentDisposition,
  parseRangeHeader,
} from './utils'

// ============= FILE TYPE CONSTANTS =============

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
