// packages/lib/src/files/folder-files/index.ts

/**
 * `FolderFile` reads and writes written to the `files/` {@link ../ctx.FilesCtx}
 * contract. Explicit named exports only — an implicit surface is how
 * `core/file-service.ts` reached 1,982 lines for a used surface of eighteen.
 */

export type { FolderFileContentDeps, GetFolderFileContentOptions } from './content'
export {
  getFolderFileContent,
  resolveFolderFileObjectRef,
  streamFolderFileContent,
} from './content'
export type {
  FolderFileDownloadDeps,
  FolderFileDownloadRef,
  GetFolderFileDownloadRefOptions,
} from './download'
export {
  DEFAULT_DOWNLOAD_TTL_MS,
  getFolderFileDownloadRef,
  resolveFolderFileDownloadRef,
} from './download'
export type {
  CopyFolderFileInput,
  CreateFolderFileInput,
  CreateFolderFileWithVersionInput,
  UpdateFolderFileInput,
} from './file-mutations'
export {
  copyFolderFile,
  createFolderFile,
  createFolderFileWithVersion,
  deleteFolderFile,
  moveFolderFile,
  renameFolderFile,
  restoreFolderFile,
  updateFolderFile,
} from './file-mutations'
export type {
  FileVersionWithLocation,
  FolderFilePage,
  FolderFileVersionSelector,
  ListFolderFilesOptions,
  SearchFolderFilesOptions,
} from './file-queries'
export {
  findFolderFilesByExtension,
  findFolderFilesByMimeType,
  findOrphanedFolderFiles,
  getFolderFile,
  getFolderFileCurrentVersion,
  getFolderFileVersionByNumber,
  getFolderFileVersions,
  getFolderFileWithRelations,
  getLatestFolderFileVersion,
  listFolderFiles,
  loadCurrentFileVersion,
  MAX_PATH_COLLISION_ATTEMPTS,
  requireFolderFile,
  resolveFolderFileVersion,
  resolveUniqueFilePath,
  searchFolderFiles,
} from './file-queries'
export type { FolderFileWriteDeps } from './ports'
export type { CreatedFileVersion, CreateFileVersionInput } from './version-mutations'
export {
  copyFileVersions,
  createFileVersion,
  deleteFileVersion,
  restoreFileVersion,
} from './version-mutations'
