// packages/lib/src/files/server.ts
// Server orchestration-only exports for file operations (no image processing / sharp).

export { cleanupService } from './cleanup/cleanup-service'
export { AttachmentService, createAttachmentService } from './core/attachment-service'
export { createFileService, FileService } from './core/file-service'
export { createMediaAssetService, MediaAssetService } from './core/media-asset-service'
export { enqueueEnsureThumbnail } from './core/thumbnail-enqueue'
export type {
  AssetKind,
  AttachmentRole,
  CreateAssetRequest,
  CreateAttachmentRequest,
  CreateFileRequest,
  FolderTreeNode,
  UpdateAssetRequest,
  UpdateAttachmentRequest,
  UpdateFileRequest,
} from './core/types'
export type {
  StorageCopyParams,
  StorageDownloadParams,
  StorageHealthCheck,
  StorageMigrationParams,
  StorageUploadParams,
  StorageUsageStats,
} from './storage/storage-manager'
export { createStorageManager, StorageManager } from './storage/storage-manager'
export { UploadErrorHandler } from './upload/error-handling'
export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'
export { ProgressPublisher } from './upload/progress-publisher'
// Upload/session orchestration (no image processing)
export { FileUploadSession, SessionManager } from './upload/session-index'
export { createFileDownloadResponse, parseRangeHeader } from './utils'
