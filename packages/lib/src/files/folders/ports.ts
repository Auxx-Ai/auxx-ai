// packages/lib/src/files/folders/ports.ts

/**
 * The dependency slices the folder write path declares.
 *
 * Same two rules as `assets/ports.ts`. **Collaborators are parameters**: copying
 * a folder has to copy each file's version chain, and the legacy body reached
 * for that collaborator inside the loop (`new FileService(this.organizationId,
 * this.userId, this.db)` — constructed once per file, inside a transaction,
 * against a service that would have opened its own). **Take a narrowed slice**:
 * a write that stamps `updatedAt` needs `now` and nothing else.
 *
 * When PR 5c lands `files/folder-files/`, {@link FileVersionCopyPort} is what it
 * implements — deliberately narrower than `FileService`, naming only the one
 * method the folder copy path uses.
 */

import type { FilesDeps } from '../ctx'

export interface FileVersionCopyPort {
  /**
   * Copy every version of `sourceFileId` onto `targetFileId`.
   *
   * The rows are duplicated; the underlying storage objects are shared, which is
   * what `FileService.copyVersions` has always done. Must resolve, not throw,
   * for a source file with no versions.
   */
  copyFileVersions(sourceFileId: string, targetFileId: string): Promise<void>
}

/**
 * What a folder write that stamps a timestamp needs.
 *
 * `Folder.updatedAt` and `FolderFile.updatedAt` are both `NOT NULL` with no
 * database default and no Drizzle `$onUpdate`, so every insert and every update
 * has to supply one. Reading the clock inside the function is what made the
 * legacy writes untestable without process-global fake timers.
 */
export type FolderWriteDeps = Pick<FilesDeps, 'now'>

/** {@link FolderWriteDeps} plus the version copier a folder copy fans out to. */
export interface FolderCopyDeps extends FolderWriteDeps {
  files: FileVersionCopyPort
}
