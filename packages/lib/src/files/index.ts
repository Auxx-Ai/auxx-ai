// packages/lib/src/files/index.ts
/**
 * Main entry point for file services
 * Exports all public APIs for file management in the new organized structure
 */

// ============= CORE SERVICES =============

// Base Service - Shared functionality for all services
export { BaseService } from './core/base-service'

// File Service - Core file management operations
export { FileService, createFileService } from './core/file-service'
export type { CreateFileRequest, UpdateFileRequest, FolderTreeNode } from './core/types'

// Folder Service - Folder hierarchy management
export { FolderService, createFolderService } from './core/folder-service'
export type { CreateFolderRequest, UpdateFolderRequest } from './core/types'

export { FilesystemService, createFilesystemService } from './core/filesystem-service'
export type { GetFileSystemOptions, BreadcrumbItem } from './core/filesystem-service'

// Attachment Service - Entity attachment management
export { AttachmentService, createAttachmentService } from './core/attachment-service'
export type { CreateAttachmentRequest, UpdateAttachmentRequest, AttachmentRole } from './core/types'

// Media Asset Service - Media-specific operations
export { MediaAssetService, createMediaAssetService } from './core/media-asset-service'
export type { CreateAssetRequest, UpdateAssetRequest, AssetKind } from './core/types'

// Thumbnail Service - Thumbnail generation and management
export { ThumbnailService } from './core/thumbnail-service'
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
} from './core/thumbnail-types'
export { THUMBNAIL_PRESETS, THUMBNAIL_LIMITS, ALLOWED_IMAGE_TYPES } from './core/thumbnail-types'

// Filesystem Service - Unified bulk loading operations

// ============= STORAGE SYSTEM =============

// Storage Manager - Unified storage operations
export { StorageManager, createStorageManager } from './storage/storage-manager'
export type {
  StorageUploadParams,
  StorageDownloadParams,
  StorageCopyParams,
  StorageMigrationParams,
  StorageUsageStats,
  StorageHealthCheck,
} from './storage/storage-manager'

// Storage Location Service - Database operations for storage locations
export { StorageLocationService, storageLocationService } from './storage/storage-location-service'
export type {
  CreateStorageLocationRequest,
  UpdateStorageLocationRequest,
  StorageLocationWithCredentials,
  BulkStorageOperationOptions,
  BulkStorageOperationResult,
} from './storage/storage-location-service'

// Storage Adapters
export { BaseStorageAdapter } from './adapters/base-adapter'
export { S3Adapter } from './adapters/s3-adapter'
export type {
  StorageAdapter,
  ProviderId,
  ProviderAuth,
  StorageCapabilities,
  FileMetadata,
  StorageLocationRef,
  PresignedUpload,
  MultipartUpload,
  FileRevision,
  WebhookEvent,
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
  StorageQuotaError,
  StorageUnsupportedError,
} from './adapters/base-adapter'

// ============= UPLOAD SYSTEM =============

import { createFileUploadService } from './upload/upload-service'

// File Upload Service - Modern upload system with StorageManager integration
export { FileUploadService, createFileUploadService } from './upload/upload-service'

// Import for internal use in fileUploadService
import type { UploadServiceConfig } from './upload/enhanced-types'

// Default service instance for backward compatibility
// Note: This requires organization ID to be provided when using
export const fileUploadService = {
  create: (organizationId: string, config?: UploadServiceConfig) =>
    createFileUploadService(organizationId, config),
}
export type {
  UploadRequest,
  UploadResult,
  UploadStrategy,
  UploadServiceConfig,
  BatchUploadResult,
  BatchUploadOptions,
  UploadProgress,
  UploadProgressCallback,
} from './upload/enhanced-types'

// Upload strategies
export {
  BaseUploadStrategy,
  DirectUploadStrategy,
  MultipartUploadStrategy,
  PresignedUploadStrategy,
  UploadStrategySelector,
} from './upload/strategies'

// Upload Session Management
export { FileUploadSession, SessionManager } from './upload/session-index'

// Upload Progress & Events
export { FileUploadProgressTracker } from './upload/progress/progress-tracker'

// Legacy Upload Types (for backward compatibility)
export type { FileUploadParams, FileUploadResult } from './upload/types'

// ============= LIFECYCLE MANAGEMENT =============

// Cleanup Services
export {
  deleteEntityFiles,
  deleteFilesByIds,
  deleteOrganizationFiles,
  deleteOrphanedFiles,
  deleteExpiredFiles,
  cleanupFailedUpload,
} from './lifecycle/cleanup-service'

export { orphanedFileCleanupJob, deletedFileCleanupJob } from './lifecycle/orphaned-cleanup'
export type { OrphanedFileCleanupJobData, OrphanedFileCleanupResult } from './lifecycle/types'

export {
  calculateStorageUsage,
  storageQuotaCheckJob,
  quotaEnforcementCleanupJob,
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

// Validators
export {
  validateFile,
  validateFileSize,
  validateMimeType,
  validateExtension,
  validateFilename,
  sanitizeFilename,
  getMimeTypeFromExtension,
} from './upload/validators'

export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'

// Additional public exports expected by apps/web
export { ProgressPublisher } from './upload/progress-publisher'
export { UploadErrorHandler } from './upload/error-handling'
export { cleanupService } from './cleanup/cleanup-service'
export { ENTITY_TYPES } from './types'
export type { EntityType } from './types'

// Selected utilities re-exported for convenience
export { createFileDownloadResponse, parseRangeHeader } from './utils'

// ============= FILE TYPE CONSTANTS =============

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
