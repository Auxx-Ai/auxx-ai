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
// MediaAsset reads/writes (PR 5a). `mediaAssetRouter` and `attachmentRouter`
// call these directly.
export { convertTempAssetToPermanent, getAsset } from './assets'
// Attachment reads/writes (PR 5b). `attachmentRouter` calls these directly.
export type { CreateAttachmentInput, UpdateAttachmentInput } from './attachments'
export {
  createAttachment,
  deleteAttachment,
  getAttachment,
  getEntityAttachments,
  updateAttachment,
} from './attachments'
// The ambient contract every `files/` function is written against. Exported so
// `apps/web`'s single `toFilesCtx` helper can name the type it returns.
export type { FilesCtx, FilesDeps, FilesDepsSlice } from './ctx'
// The unified filesystem view over `Folder` + `FolderFile` (PR 5e).
// `FilesystemService` was deleted outright -- all three call sites were in
// `fileRouter` and all three were converted.
export type {
  BreadcrumbItem,
  FileItem,
  FileSystemResult,
  GetFileSystemOptions,
  MoveEntryOutcome,
  MoveItemsResult,
  PlanMoveItemsInput,
} from './filesystem'
export {
  buildBreadcrumbs,
  buildMovePlan,
  executeMoveEntry,
  getCompleteFileSystem,
  planMoveItems,
  renameFilesystemItem,
  summarizeMoveOutcomes,
} from './filesystem'
// Folder reads/writes written to the `files/ctx.ts` contract (PR 5d).
// `folderRouter` calls these directly -- there is no `FolderService` between
// them. NOTE: `FolderTreeNode` is deliberately NOT re-exported here;
// `./core/types` already exports that name through this module.
export type {
  CopyFolderInput,
  CreateFolderInput,
  FileVersionCopyPort,
  FolderCopyDeps,
  FolderCounts,
  FolderDetail,
  FolderPage,
  FolderSearchHit,
  FolderUsage,
  FolderWriteDeps,
  ListFoldersOptions,
  SearchFoldersOptions,
  UpdateFolderInput,
} from './folders'
export {
  copyFolder,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  getFolder,
  getFolderAncestors,
  getFolderCounts,
  getFolderDescendants,
  getFolderTree,
  getFolderUsage,
  getFolderWithRelations,
  getSubfolders,
  isFolderNameAvailable,
  listFolders,
  mergeFolders,
  moveFolder,
  permanentlyDeleteFolder,
  renameFolder,
  restoreFolder,
  searchFolders,
  updateFolder,
} from './folders'
// FolderFile reads/writes written to the `files/ctx.ts` contract (PR 5c).
// `fileRouter` calls these directly — there is no `FileService` between them.
export type {
  CopyFolderFileInput,
  CreatedFileVersion,
  CreateFileVersionInput,
  CreateFolderFileInput,
  CreateFolderFileWithVersionInput,
  FileVersionWithLocation,
  FolderFileDownloadDeps,
  FolderFileDownloadRef,
  FolderFilePage,
  FolderFileVersionSelector,
  FolderFileWriteDeps,
  GetFolderFileDownloadRefOptions,
  ListFolderFilesOptions,
  SearchFolderFilesOptions,
  UpdateFolderFileInput,
} from './folder-files'
export {
  copyFileVersions,
  copyFolderFile,
  createFileVersion,
  createFolderFile,
  createFolderFileWithVersion,
  deleteFileVersion,
  deleteFolderFile,
  findFolderFilesByExtension,
  findFolderFilesByMimeType,
  findOrphanedFolderFiles,
  getFolderFile,
  getFolderFileCurrentVersion,
  getFolderFileDownloadRef,
  getFolderFileVersionByNumber,
  getFolderFileVersions,
  getFolderFileWithRelations,
  getLatestFolderFileVersion,
  listFolderFiles,
  moveFolderFile,
  renameFolderFile,
  resolveFolderFileDownloadRef,
  restoreFileVersion,
  restoreFolderFile,
  searchFolderFiles,
  updateFolderFile,
} from './folder-files'
// The production `StoragePort`. Routers need it to build the `deps` slice the
// download functions take; constructing one per request is cheap because the
// port shares the single cached S3 adapter.
export { createS3StoragePort } from './storage/ports'
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
// The deprecated adapter over `upload/errors.ts`. Kept only until the three
// upload routes import the functions below directly (PR 4e); it is the reason
// this PR did not have to touch them.
export { UploadErrorHandler } from './upload/error-handling'
// Upload error classification (PR 4c). Pure -- no db, no redis, no clock.
// Replaces the substring ladder that answered 413 "upgrade your plan" for any
// message containing `limit` and 401 for any message containing `token`.
export type {
  ClassifiedUploadError,
  UploadErrorBody,
  UploadErrorMeta,
  UploadErrorType,
} from './upload/errors'
export {
  classifyUploadError,
  toUploadErrorResponse,
  UNEXPECTED_UPLOAD_ERROR_MESSAGE,
  uploadErrorResponse,
  uploadUnauthorizedError,
  uploadValidationError,
} from './upload/errors'
export { ensureProcessorsInitialized, ProcessorRegistry } from './upload/processors'
// Upload/session orchestration (no image processing)
export {
  createUploadSession,
  deleteUploadSession,
  failUploadSession,
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
