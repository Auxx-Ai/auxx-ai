// packages/lib/src/files/assets/ports.ts

/**
 * The dependency slices the asset write path declares.
 *
 * Two rules from `files/ctx.ts` meet here. First, **collaborators are
 * parameters**: deleting an asset has to drop the thumbnails derived from it,
 * and the legacy code reached for that collaborator inside the delete body
 * (`await import('./thumbnail-service'); new ThumbnailService(org, user, db)`),
 * which welds the function to it and leaves `vi.mock` as the only way a test can
 * get at it. Second, **take a narrowed slice, never the whole bundle**: a write
 * that stamps `updatedAt` needs `now` and nothing else, so that is all its
 * signature asks for.
 *
 * When PR 5f lands `files/thumbnails/`, {@link ThumbnailCleanupPort} is what it
 * implements — deliberately narrower than `ThumbnailService`, naming only the
 * one method the asset write path uses.
 */

import type { FilesDeps } from '../ctx'

export interface ThumbnailCleanupPort {
  /**
   * Drop every thumbnail derived from one source version.
   *
   * Soft-deletes the thumbnail rows and removes their storage objects. Must
   * resolve, not throw, for a source version that has no thumbnails.
   */
  deleteThumbnailsForSource(sourceVersionId: string): Promise<void>
}

/**
 * What a write that stamps a timestamp needs.
 *
 * `MediaAsset.updatedAt` is `NOT NULL` with no database default and no Drizzle
 * `$onUpdate`, so every insert and every update has to supply it. Reading the
 * clock inside the function is what made the legacy writes untestable without
 * process-global fake timers.
 */
export type AssetWriteDeps = Pick<FilesDeps, 'now'>

/** {@link AssetWriteDeps} plus the thumbnail closure a soft delete has to sweep. */
export interface AssetDeleteDeps extends AssetWriteDeps {
  thumbnails: ThumbnailCleanupPort
}

/** A version delete stamps nothing, so it needs the thumbnail sweep alone. */
export interface AssetVersionDeleteDeps {
  thumbnails: ThumbnailCleanupPort
}
