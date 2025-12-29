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

// Export all core services
export { FileService, createFileService } from './file-service'
export { FolderService, createFolderService } from './folder-service'
export { AttachmentService } from './attachment-service'
export { MediaAssetService, createMediaAssetService } from './media-asset-service'
export { ThumbnailService } from './thumbnail-service'

// Export base service and mixins for advanced usage
export { BaseService, type Constructor } from './base-service'
export { withContentAccess, withVersioning } from './mixins'
export type { ContentAccessible, Versioned } from './mixins'

// Export all types
export type {
  // Entity types
  EntityType,
  AttachmentRole,
  AssetKind,

  // Request types
  CreateFileRequest,
  UpdateFileRequest,
  CreateFolderRequest,
  UpdateFolderRequest,
  CreateAttachmentRequest,
  UpdateAttachmentRequest,
  CreateAssetRequest,
  UpdateAssetRequest,

  // Response types
  FolderTreeNode,
  FolderContents,
  FileSearchResult,
  AssetSearchResult,
  FileDownloadInfo,
  AssetDownloadInfo,

  // Extended model types
  FolderFileWithRelations,
  MediaAssetWithRelations,
  AttachmentWithRelations,
  FolderWithRelations,

  // Service options
  FileListOptions,
  SearchOptions,
  BulkOperationOptions,

  // Utility types
  ValidationResult,
  ServiceResult,
  BulkOperationResult,
} from './types'

// Export thumbnail types
export type {
  ThumbnailSource,
  ThumbnailOptions,
  ThumbnailResult,
  PresetKey,
  PresetConfig,
  ThumbnailMetadata,
  ProcessedThumbnail,
  ThumbnailSet,
  GenerateThumbnailPayload,
  ThumbnailServiceConfig,
} from './thumbnail-types'

export {
  THUMBNAIL_PRESETS,
  THUMBNAIL_LIMITS,
  ALLOWED_IMAGE_TYPES,
} from './thumbnail-types'
