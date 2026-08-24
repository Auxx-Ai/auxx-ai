// packages/lib/src/files/core/index.ts

/**
 * What is left of `files/core/` after the service classes were deleted.
 *
 * `AttachmentService`, `BaseService`, `FileService`, `FilesystemService`,
 * `FolderService`, `MediaAssetService` and `ThumbnailService` are all gone (PRs
 * 5a-5g). Their replacements are `db`-first functions under `files/assets/`,
 * `files/attachments/`, `files/folder-files/`, `files/folders/`,
 * `files/filesystem/` and `files/thumbnails/`, exported from
 * `@auxx/lib/files/server`. `core/mixins/` went with them: `ContentAccessible`
 * and `Versioned` existed only to be `implements`-ed by two of those classes.
 *
 * What remains here is the shared request/response **types** and the sharp
 * image pipeline. This barrel has no importer of its own -- it is kept as the
 * one place that names what `core/` still holds.
 */

// Thumbnails moved to `files/thumbnails/` in PR 5f. `ThumbnailService` is gone;
// the types and presets are re-exported from their new home so this barrel keeps
// naming one place.
export type {
  GenerateThumbnailPayload,
  PresetConfig,
  PresetKey,
  ProcessedThumbnail,
  ThumbnailMetadata,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from '../thumbnails/presets'
export {
  ALLOWED_IMAGE_TYPES,
  THUMBNAIL_LIMITS,
  THUMBNAIL_PRESETS,
} from '../thumbnails/presets'
// Export all types
export type {
  AssetDownloadInfo,
  AssetKind,
  AssetSearchResult,
  AttachmentRole,
  AttachmentWithRelations,
  BulkOperationOptions,
  BulkOperationResult,
  CreateAssetRequest,
  CreateAttachmentRequest,
  // Request types
  CreateFileRequest,
  CreateFolderRequest,
  // Entity types
  EntityType,
  FileDownloadInfo,
  // Service options
  FileListOptions,
  FileSearchResult,
  FolderContents,
  // Extended model types
  FolderFileWithRelations,
  // Response types
  FolderTreeNode,
  FolderWithRelations,
  MediaAssetWithRelations,
  SearchOptions,
  ServiceResult,
  UpdateAssetRequest,
  UpdateAttachmentRequest,
  UpdateFileRequest,
  UpdateFolderRequest,
  // Utility types
  ValidationResult,
} from './types'
