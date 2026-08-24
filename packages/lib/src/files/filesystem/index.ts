// packages/lib/src/files/filesystem/index.ts

/**
 * The unified filesystem view over `Folder` + `FolderFile`: one bulk read for
 * the Files app, and the bulk move/rename it drives.
 *
 * Written to the `files/` {@link ../ctx.FilesCtx} contract, with the decision
 * logic pure and the transaction boundary owned by the caller. Explicit named
 * exports only.
 *
 * There is **no facade** for `FilesystemService`: it had exactly three external
 * call sites, all in `fileRouter`, and all three were converted in the same PR.
 */

export { executeMoveEntry, renameFilesystemItem } from './filesystem-mutations'
export type {
  FileSystemResult,
  GetFileSystemOptions,
  PlanMoveItemsInput,
} from './filesystem-queries'
export { DEFAULT_FILES_LIMIT, getCompleteFileSystem, planMoveItems } from './filesystem-queries'
export type {
  BreadcrumbItem,
  FileCursor,
  FileItem,
  FilesystemFileRow,
  FilesystemFolderRow,
  FolderCountPair,
} from './items'
export {
  buildBreadcrumbs,
  decodeFileCursor,
  encodeFileCursor,
  fileItemFromFile,
  fileItemFromFolder,
  fileItemFromFolderRow,
  fileItemFromRow,
  ROOT_FOLDER_NAME,
} from './items'
export type {
  BuildMovePlanOptions,
  MoveCollisionPolicy,
  MoveEntryOutcome,
  MoveFileRow,
  MoveItemRef,
  MoveItemsResult,
  MovePlanEntry,
  MoveSnapshot,
} from './move-plan'
export {
  buildMovePlan,
  generateUniqueName,
  MAX_RENAME_ATTEMPTS,
  pruneNestedSelections,
  summarizeMoveOutcomes,
} from './move-plan'
export type { FilesystemWriteDeps } from './ports'
