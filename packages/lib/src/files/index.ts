// packages/lib/src/files/index.ts
/**
 * Main entry point for file services
 * Exports all public APIs for file management in the new organized structure
 */

// ============= CORE SERVICES =============

// Attachment Service - Entity attachment management
export { AttachmentService, createAttachmentService } from './core/attachment-service'
// Base Service - Shared functionality for all services
export { BaseService } from './core/base-service'
// File Service - Core file management operations
export { createFileService, FileService } from './core/file-service'
export type { BreadcrumbItem, GetFileSystemOptions } from './core/filesystem-service'
export { createFilesystemService, FilesystemService } from './core/filesystem-service'
// Folder Service - Folder hierarchy management
export { createFolderService, FolderService } from './core/folder-service'
// Media Asset Service - Media-specific operations
export { createMediaAssetService, MediaAssetService } from './core/media-asset-service'
// Thumbnail Service - Thumbnail generation and management
export { ThumbnailService } from './core/thumbnail-service'
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

// Filesystem Service - Unified bulk loading operations

// ============= STORAGE SYSTEM =============

export type {
  FileMetadata,
  FileRevision,
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
  WebhookEvent,
} from './adapters/base-adapter'
// Storage Adapters
export { BaseStorageAdapter } from './adapters/base-adapter'
export { S3Adapter } from './adapters/s3-adapter'
export type {
  BulkStorageOperationOptions,
  BulkStorageOperationResult,
  CreateStorageLocationRequest,
  StorageLocationWithCredentials,
  UpdateStorageLocationRequest,
} from './storage/storage-location-service'
// Storage Location Service - Database operations for storage locations
export { StorageLocationService, storageLocationService } from './storage/storage-location-service'
export type {
  StorageCopyParams,
  StorageDownloadParams,
  StorageHealthCheck,
  StorageMigrationParams,
  StorageUploadParams,
  StorageUsageStats,
} from './storage/storage-manager'
// Storage Manager - Unified storage operations
export { createStorageManager, StorageManager } from './storage/storage-manager'

// ============= UPLOAD SYSTEM =============

import { createFileUploadService } from './upload/upload-service'

// File Upload Service - Modern upload system with StorageManager integration
export { createFileUploadService, FileUploadService } from './upload/upload-service'

// Import for internal use in fileUploadService
import type { UploadServiceConfig } from './upload/enhanced-types'

// Default service instance for backward compatibility
// Note: This requires organization ID to be provided when using
export const fileUploadService = {
  create: (organizationId: string, config?: UploadServiceConfig) =>
    createFileUploadService(organizationId, config),
}
export type {
  BatchUploadOptions,
  BatchUploadResult,
  UploadProgress,
  UploadProgressCallback,
  UploadRequest,
  UploadResult,
  UploadServiceConfig,
  UploadStrategy,
} from './upload/enhanced-types'
// Upload Progress & Events
export { FileUploadProgressTracker } from './upload/progress/progress-tracker'

// Upload Session Management
export { FileUploadSession, SessionManager } from './upload/session-index'
// Upload strategies
export {
  BaseUploadStrategy,
  DirectUploadStrategy,
  MultipartUploadStrategy,
  PresignedUploadStrategy,
  UploadStrategySelector,
} from './upload/strategies'

// Legacy Upload Types (for backward compatibility)
export type { FileUploadParams, FileUploadResult } from './upload/types'

// ============= LIFECYCLE MANAGEMENT =============

// Cleanup Services
export {
  cleanupFailedUpload,
  deleteEntityFiles,
  deleteExpiredFiles,
  deleteFilesByIds,
  deleteOrganizationFiles,
  deleteOrphanedFiles,
} from './lifecycle/cleanup-service'

export { deletedFileCleanupJob, orphanedFileCleanupJob } from './lifecycle/orphaned-cleanup'
export {
  calculateStorageUsage,
  quotaEnforcementCleanupJob,
  storageQuotaCheckJob,
} from './lifecycle/quota-cleanup'
export type { OrphanedFileCleanupJobData, OrphanedFileCleanupResult } from './lifecycle/types'

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

export { cleanupService } from './cleanup/cleanup-service'
export type { EntityType } from './types'
export { ENTITY_TYPES } from './types'
export { UploadErrorHandler } from './upload/error-handling'
export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'
// Additional public exports expected by apps/web
export { ProgressPublisher } from './upload/progress-publisher'
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
export { createFileDownloadResponse, parseRangeHeader } from './utils'

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
