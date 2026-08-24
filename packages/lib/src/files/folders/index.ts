// packages/lib/src/files/folders/index.ts

/**
 * `Folder` reads, writes, repair sweeps and the pure hierarchy algorithms,
 * written to the `files/` {@link ../ctx.FilesCtx} contract.
 *
 * Explicit named exports only — an implicit surface is how
 * `core/folder-service.ts` reached 1,945 lines across 45 methods, 23 of which
 * anything called and 3 of which existed twice under different names.
 */

export type {
  CopyFolderInput,
  CreateFolderInput,
  UpdateFolderInput,
} from './folder-mutations'
export {
  assertNameAvailable,
  copyFolder,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  mergeFolders,
  moveFolder,
  permanentlyDeleteFolder,
  renameFolder,
  restoreFolder,
  updateFolder,
} from './folder-mutations'
export type {
  FolderCounts,
  FolderDetail,
  FolderPage,
  FolderSearchHit,
  FolderUsage,
  ListFoldersOptions,
  SearchFoldersOptions,
} from './folder-queries'
export {
  DEFAULT_LIST_LIMIT,
  DETAIL_FILE_LIMIT,
  findFolder,
  findFolderByNameAndParent,
  folderScope,
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
  liveFilesIn,
  loadFileAggregates,
  loadFolderNodes,
  loadFoldersByIds,
  requireFolder,
  searchFolders,
} from './folder-queries'
export type { RepairReport } from './maintenance'
export {
  cleanupEmptyFolders,
  fixFolderDepths,
  rebuildFolderPaths,
} from './maintenance'
export type {
  FileVersionCopyPort,
  FolderCopyDeps,
  FolderWriteDeps,
} from './ports'
export type {
  FolderAggregate,
  FolderNode,
  FolderShape,
  FolderTreeNode,
} from './tree'
export {
  ancestorsOf,
  buildFolderTree,
  computePath,
  computeTreeShape,
  descendantsOf,
  driftedShapes,
  escapeLikePattern,
  indexById,
  indexByParent,
  isAncestorOf,
  isValidFolderName,
  joinPath,
  normalizeParentId,
  pathPrefix,
  ROOT_PATH,
  wouldCreateCycle,
} from './tree'
