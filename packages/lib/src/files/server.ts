// packages/lib/src/files/server.ts
// Server orchestration-only exports for file operations (no image processing / sharp).

// MediaAsset reads/writes (PR 5a).
//
// This re-exports `assets/index.ts` in full rather than the handful of names a
// particular router happened to need. Earlier PRs added only their own, which
// left 2 of 30 functions reachable and made the Phase 10 consumer sweep
// export-blocked rather than call-site-blocked -- 12 of 13 sites could not move.
// `assets/index.ts` is already a curated surface (it is explicit-named for
// exactly this reason), so re-exporting it wholesale adds no unvetted API.
export type {
  AssetContentDeps,
  AssetDeleteDeps,
  AssetDownloadRefWithMeta,
  AssetPage,
  AssetVersionAddress,
  AssetVersionDeleteDeps,
  AssetVersionSelector,
  AssetVersionWithLocation,
  AssetWriteDeps,
  CreateAssetFromFolderFileInput,
  CreateAssetInput,
  CreateAssetVersionInput,
  CreateAssetWithVersionInput,
  CreatedAssetVersion,
  DownloadDeps,
  GetAssetContentOptions,
  GetAssetDownloadRefOptions,
  ListAssetsOptions,
  ThumbnailCleanupPort,
  UpdateAssetContentInput,
  UpdateAssetInput,
  VersionWithLocation,
} from './assets'
export {
  convertTempAssetToPermanent,
  createAsset,
  createAssetFromFolderFile,
  createAssetVersion,
  createAssetWithVersion,
  DEFAULT_ASSET_DOWNLOAD_TTL_MS,
  deleteAsset,
  deleteAssetVersion,
  findAssetsByKind,
  findExpiredAssets,
  getAsset,
  getAssetContent,
  getAssetCurrentVersion,
  getAssetDownloadRef,
  getAssetDownloadRefWithMeta,
  getAssetVersionByNumber,
  getAssetVersions,
  getAssetWithRelations,
  getLatestAssetVersion,
  listAssets,
  loadCurrentVersion,
  requireAsset,
  resolveAssetDownloadRef,
  resolveAssetObjectRef,
  resolveAssetVersion,
  restoreAssetVersion,
  streamAssetContent,
  updateAsset,
  updateAssetContent,
} from './assets'
// Attachment reads/writes (PR 5b), likewise re-exported in full.
export type {
  AttachmentDownloadDeps,
  AttachmentSide,
  CreateAttachmentInput,
  GetAttachmentDownloadRefOptions,
  GroupedAttachmentInfo,
  LocationDownloadParams,
  LocationDownloadPort,
  ResolvedAttachmentVersion,
  UpdateAttachmentInput,
} from './attachments'
export {
  assertExactlyOneTarget,
  createAttachment,
  createStorageManagerLocationPort,
  deleteAttachment,
  fetchAttachmentsForEntities,
  getAttachment,
  getAttachmentDownloadInfo,
  getAttachmentDownloadRef,
  getEntityAttachments,
  requireAttachment,
  requireResolvedVersion,
  resolveAttachmentDownloadRef,
  resolveAttachmentVersion,
  updateAttachment,
} from './attachments'
// The four service facades (`AttachmentService`, `FileService`,
// `FolderService`, `MediaAssetService`) and `BaseService` were DELETED in PR Y.
// Every export below is a function taking a `FilesCtx`; there is no class left
// to construct. `apps/web` builds its ctx with `~/server/lib/files-ctx`.
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
// FolderFile reads/writes written to the `files/ctx.ts` contract (PR 5c).
// `fileRouter` calls these directly — there is no `FileService` between them.
export type {
  CopyFolderFileInput,
  CreatedFileVersion,
  CreateFileVersionInput,
  CreateFolderFileInput,
  CreateFolderFileWithVersionInput,
  FileVersionWithLocation,
  FolderFileContentDeps,
  FolderFileDownloadDeps,
  FolderFileDownloadRef,
  FolderFilePage,
  FolderFileVersionSelector,
  FolderFileWriteDeps,
  GetFolderFileContentOptions,
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
  getFolderFileContent,
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
  resolveFolderFileObjectRef,
  resolveFolderFileVersion,
  restoreFileVersion,
  restoreFolderFile,
  searchFolderFiles,
  streamFolderFileContent,
  updateFolderFile,
} from './folder-files'
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
// The production `CachePort` (PR 6c). Two methods on purpose: no site in the
// repo pairs `onCacheEvent('user.updated')` with `invalidateUser`, so widening
// the event would make `files/` mean something different by it than everywhere
// else. Both production imports are dynamic -- `cache/register-providers` ->
// `userProfileProvider` -> `files/` closes a cycle.
export { createProductionCachePort } from './storage/cache-port'
// The production `StoragePort`. Routers need it to build the `deps` slice the
// download functions take; constructing one per request is cheap because the
// port shares the single cached S3 adapter.
export type { StoragePort } from './storage/ports'
export { createS3StoragePort } from './storage/ports'
export { presignPart } from './storage/presign'
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
export {
  createThumbnailCleanupPort,
  deleteThumbnailsForSource,
  ensureThumbnail,
  ensureThumbnailPresets,
} from './thumbnails'
// Upload compensation (PR 6c): delete the object, else enqueue a cleanup.
// Exported so the public workflow-share completion route can stop leaking bytes
// on failure -- it currently does no compensation at all.
export type { CompensateDeps, CompensateInput, CompensationOutcome } from './upload/compensate'
export { compensateUploadObject } from './upload/compensate'
// The upload orchestration the three API routes used to inline (PR 4e).
// Dispatch is the handler records in `upload/handlers/`, reached through these
// two -- the `ProcessorRegistry` hierarchy was deleted in PR 4d and had no
// consumer outside the module it lived in.
export type { CompletedUpload, CompleteUploadDeps, CompleteUploadInput } from './upload/complete'
export { completeUpload } from './upload/complete'
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
export type { PreparedUpload, PrepareUploadDeps } from './upload/prepare'
export { prepareUpload } from './upload/prepare'
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
