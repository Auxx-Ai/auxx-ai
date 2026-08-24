// packages/lib/src/files/thumbnails/index.ts

/**
 * Thumbnail reads, writes, sweeps and job contract, written to the `files/`
 * {@link ../ctx.FilesCtx} contract. Explicit named exports only — an implicit
 * surface is how `thumbnail-service.ts` reached 1,038 lines with a synchronous
 * image pipeline nothing called.
 */

export type { CleanupResult, ThumbnailCleanupDeps, ThumbnailCleanupOptions } from './cleanup'
export {
  cleanupExpiredSoftDeletes,
  cleanupFailedThumbnails,
  cleanupOrphanedThumbnails,
  cleanupOutdatedVersionThumbnails,
  processThumbnailDeletions,
  resolveThumbnailBucket,
} from './cleanup'
export type {
  GenerateThumbnailPayload,
  PresetConfig,
  PresetKey,
  ProcessedThumbnail,
  ThumbnailMetadata,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from './presets'
export {
  ALLOWED_IMAGE_TYPES,
  assertPresetKey,
  DEFAULT_PRESET,
  isPresetKey,
  mimeTypeForFormat,
  THUMBNAIL_LIMITS,
  THUMBNAIL_PRESETS,
  thumbnailJobId,
  thumbnailJobKey,
  thumbnailLatchKey,
} from './presets'
export type { ThumbnailLatchRedis } from './thumbnail-job'
export {
  acquireThumbnailLatch,
  generateThumbnailSchema,
  holdThumbnailLatch,
  releaseThumbnailLatch,
  THUMBNAIL_JOB_NAME,
  THUMBNAIL_LATCH_TTL_SEC,
} from './thumbnail-job'
export type {
  EnsureThumbnailInput,
  EnsureThumbnailPresetsInput,
  ThumbnailDeleteDeps,
  ThumbnailEnqueueDeps,
  ThumbnailPresetResult,
} from './thumbnail-mutations'
export {
  createThumbnailCleanupPort,
  deleteThumbnailsForSource,
  ensureThumbnail,
  ensureThumbnailPresets,
  resolveThumbnailSource,
} from './thumbnail-mutations'
export type { ResolvedThumbnailSource, ThumbnailWithLocation } from './thumbnail-queries'
export { findThumbnailByVersionAndPreset, loadThumbnail } from './thumbnail-queries'
