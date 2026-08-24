// packages/lib/src/files/folder-files/ports.ts

/**
 * The dependency slices the file-library write path declares.
 *
 * The rule from `files/ctx.ts`: **take a narrowed slice, never the whole
 * bundle**. A write that stamps `updatedAt` needs `now` and nothing else, so
 * that is all its signature asks for — a full `FilesDeps` parameter would say
 * the function may enqueue a job or write to S3, and would cost every caller a
 * live `QueuePort` (a Redis connection) to rename a file.
 *
 * There is deliberately no `ThumbnailCleanupPort` here, unlike
 * `assets/ports.ts`. Thumbnails are `MediaAsset` rows derived from a
 * `MediaAssetVersion`; nothing derives a thumbnail from a `FileVersion`, so
 * neither `deleteFolderFile` nor `deleteFileVersion` has a closure to sweep.
 */

import type { FilesDeps } from '../ctx'

/**
 * What a `FolderFile` write needs.
 *
 * `FolderFile.updatedAt` is `NOT NULL` with no database default and no Drizzle
 * `$onUpdate`, so every insert and every update has to supply it. Reading the
 * clock inside the function is what made the legacy writes untestable without
 * process-global fake timers.
 */
export type FolderFileWriteDeps = Pick<FilesDeps, 'now'>
