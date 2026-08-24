// packages/lib/src/files/core/index.ts

/**
 * Core file system services for the enhanced file management system
 *
 * This module exports the main services for handling:
 * - FolderFile: User files with folder organization and versioning
 * - MediaAsset: System files, temporary uploads, and media assets
 * - Attachment: Unified attachment system for both file types
 * - Folder: Hierarchical folder management
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
export { AttachmentService } from './attachment-service'
// Export base service and mixins for advanced usage
export { BaseService, type Constructor } from './base-service'
// Export all core services
export { createFileService, FileService } from './file-service'
export { createFolderService, FolderService } from './folder-service'
export { createMediaAssetService, MediaAssetService } from './media-asset-service'
export type { ContentAccessible, Versioned } from './mixins'
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
