// packages/lib/src/files/server.ts
// Server orchestration-only exports for file operations (no image processing / sharp).

export { cleanupService } from './cleanup/cleanup-service'
export { AttachmentService, createAttachmentService } from './core/attachment-service'
export { createFileService, FileService } from './core/file-service'
export { createMediaAssetService, MediaAssetService } from './core/media-asset-service'
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
// The production `QueuePort`, and the thumbnail enqueue that takes it.
// `files/thumbnails/` imports no image-processing code — the sharp pipeline
// lives behind `core/thumbnail-processor.worker.ts` and is reached only by the
// worker job — so this subpath keeps its "no sharp" promise.
export { createProductionQueuePort } from './storage/queue-port'
export type { StorageDownloadParams } from './storage/storage-manager'
export { createStorageManager, StorageManager } from './storage/storage-manager'
export type {
  EnsureThumbnailInput,
  EnsureThumbnailPresetsInput,
  PresetKey,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from './thumbnails'
export { deleteThumbnailsForSource, ensureThumbnail, ensureThumbnailPresets } from './thumbnails'
export { UploadErrorHandler } from './upload/error-handling'
export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'
// Upload/session orchestration (no image processing)
export {
  createUploadSession,
  deleteUploadSession,
  getUploadSession,
  patchUploadSession,
  touchUploadSession,
  uploadSessionRedis,
} from './upload/session'
export {
  createFileDownloadResponse,
  encodeContentDisposition,
  parseRangeHeader,
} from './utils'
