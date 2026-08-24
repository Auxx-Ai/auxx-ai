// packages/lib/src/files/filesystem/ports.ts

/**
 * The narrowed `deps` slice the filesystem writes take.
 *
 * A `Pick`, never the whole {@link FilesDeps} bundle: these functions move rows
 * between folders and nothing more, so a signature promising storage, a queue
 * and a cache would lie — and would cost every caller a live Redis connection to
 * rename a file (`files/ctx.ts`).
 *
 * The reads take **no** deps at all. `getCompleteFileSystem` used to stamp
 * `lastUpdated: new Date()` onto its response; that field went with the
 * incremental-sync protocol nothing ever spoke, so the read is now a pure
 * function of the database.
 */

import type { FilesDeps } from '../ctx'

/** `now`, for the `updatedAt` stamps the underlying folder and file writes make. */
export type FilesystemWriteDeps = Pick<FilesDeps, 'now'>
