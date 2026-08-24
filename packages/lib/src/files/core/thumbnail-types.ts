// packages/lib/src/files/core/thumbnail-types.ts

/**
 * @deprecated Moved to `files/thumbnails/presets.ts` in PR 5f. This file survives
 * only so `files/index.ts` — which this PR is not allowed to edit — keeps
 * resolving; every in-repo importer has been repointed at `thumbnails/presets`.
 * Delete it with `files/core/` in Phase 7.
 */

export type {
  GenerateThumbnailPayload,
  PresetConfig,
  PresetKey,
  ProcessedThumbnail,
  ThumbnailMetadata,
  ThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from '../thumbnails/presets'
export {
  ALLOWED_IMAGE_TYPES,
  THUMBNAIL_LIMITS,
  THUMBNAIL_PRESETS,
} from '../thumbnails/presets'

/**
 * @deprecated Zero callers, and zero readers of the fields it declares — nothing
 * ever constructed a thumbnail service with a config. Kept only to hold
 * `files/index.ts`'s export line valid until that barrel is edited; remove both
 * together.
 */
export interface ThumbnailServiceConfig {
  maxInputSize?: number
  maxInputPixels?: number
  maxProcessingTime?: number
  maxConcurrentJobs?: number
  debug?: boolean
}

/**
 * @deprecated Zero callers. `ensureThumbnailPresets` returns
 * `ThumbnailPresetResult[]`, which is a different shape and always was. Remove
 * with the `files/index.ts` export line.
 */
export interface ThumbnailSet {
  thumbnails: Array<{
    preset: string
    assetId: string
    assetVersionId: string
    storageLocationId: string
    size: number
  }>
  processingTimeMs: number
  sourceSize?: number
  totalOutputSize: number
}
