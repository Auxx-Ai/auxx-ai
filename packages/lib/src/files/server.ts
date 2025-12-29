// packages/lib/src/files/server.ts
// Server orchestration-only exports for file operations (no image processing / sharp).

export { FileService, createFileService } from './core/file-service'
export type { CreateFileRequest, UpdateFileRequest, FolderTreeNode } from './core/types'

export { AttachmentService, createAttachmentService } from './core/attachment-service'
export type { CreateAttachmentRequest, UpdateAttachmentRequest, AttachmentRole } from './core/types'

export { MediaAssetService, createMediaAssetService } from './core/media-asset-service'
export type { CreateAssetRequest, UpdateAssetRequest, AssetKind } from './core/types'

export { StorageManager, createStorageManager } from './storage/storage-manager'
export type {
  StorageUploadParams,
  StorageDownloadParams,
  StorageCopyParams,
  StorageMigrationParams,
  StorageUsageStats,
  StorageHealthCheck,
} from './storage/storage-manager'

export { createFileDownloadResponse, parseRangeHeader } from './utils'

// Upload/session orchestration (no image processing)
export { FileUploadSession, SessionManager } from './upload/session-index'
export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'
export { ProgressPublisher } from './upload/progress-publisher'
export { UploadErrorHandler } from './upload/error-handling'
export { cleanupService } from './cleanup/cleanup-service'
export { enqueueEnsureThumbnail } from './core/thumbnail-enqueue'
