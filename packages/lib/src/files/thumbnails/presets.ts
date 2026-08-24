// packages/lib/src/files/thumbnails/presets.ts

/**
 * The pure half of `files/thumbnails/` — preset table, limits, and the key
 * derivation that decides when two thumbnail requests are the same unit of work.
 *
 * Nothing here touches a database, a queue, storage or the clock, so all of it
 * is table-testable with no doubles at all
 * (`plans/attachments/09-testing-strategy.md` §9.2, shape 1).
 *
 * ## Why the key derivation lives here rather than at each enqueue site
 *
 * There used to be two of them, and they disagreed.
 * `ThumbnailService.makeKey` hashed `{versionId, preset, format, quality}`;
 * `thumbnail-enqueue.ts` built `${versionId}:${preset}:${q}:${vis}`. The worker
 * (`jobs/maintenance/generate-thumbnail-job.ts`) then released a latch at the
 * hard-coded string `processing:thumb-${key}` — which only ever matched the
 * first of the two. So jobs enqueued through `enqueueEnsureThumbnail` set no
 * latch, got no deterministic job id, and were therefore not deduplicated at
 * all: the upload-complete route enqueues four avatar presets per upload and a
 * retried completion enqueued four more.
 *
 * One derivation, exported, used by the enqueuer *and* by the worker's release,
 * is what stops that recurring.
 *
 * The hashed inputs are the *content* identity of the output: two requests for
 * the same source version and preset but a different `format` or `quality`
 * produce genuinely different bytes and must not collapse onto one job.
 * `queue` and `visibility` are deliberately **not** in the key —
 * `queue` is a routing choice with no effect on the output, and the database's
 * own dedup (`idx_unique_thumbnail` on
 * `(derivedFromVersionId, preset) WHERE deletedAt IS NULL`) already treats
 * visibility as irrelevant, so including it would let two jobs race for one
 * unique index slot.
 */

import { createHash } from 'node:crypto'
import { BadRequestError } from '../../errors'

/**
 * Where a thumbnail's source bytes come from.
 *
 * **`{ type: 'file' }` was removed in PR 5f.** It had zero call sites in the
 * repo; the file-library path is still reachable, but only through an
 * `Attachment` that points at a `FolderFile`, which is what
 * `resolveThumbnailSource` handles. A source variant nothing constructs is a
 * branch nothing tests.
 */
export type ThumbnailSource =
  | { type: 'asset'; assetId: string; assetVersionId?: string }
  | { type: 'attachment'; attachmentId: string }

/** Knobs that reach the preset table and the job payload. */
export interface ThumbnailOptions {
  /** Preset to use for sizing and format. Defaults to `avatar-64`. */
  preset?: PresetKey
  /**
   * Kept for wire compatibility with the persisted job payload. Since PR 5f
   * there is no synchronous branch — `ensureThumbnail` always enqueues — so this
   * changes nothing and is not part of the job key.
   *
   * @deprecated Nothing reads it. Remove with the payload's next version bump.
   */
  queue?: boolean
  /** Override the preset's output format. */
  format?: 'webp' | 'jpeg' | 'png'
  /** Override the preset's compression quality. */
  quality?: number
  /** Which bucket the output routes to. Defaults to the source's own visibility. */
  visibility?: 'PUBLIC' | 'PRIVATE'
  /** Write `User.image` when the preset lands. Honoured by the worker for `avatar-64`. */
  updateUser?: boolean
}

/** Every preset the system knows how to render. */
export type PresetKey =
  | 'avatar-32'
  | 'avatar-64'
  | 'avatar-128'
  | 'avatar-256'
  | 'article-thumb'
  | 'article-cover'
  | 'article-inline'
  | 'attachment-preview'
  | 'attachment-thumb'
  | 'comment-preview'
  | 'comment-preview-large'
  | 'kb-logo-sm'
  | 'kb-logo-lg'

/** One preset's rendering parameters. */
export interface PresetConfig {
  /** Width in pixels. */
  w: number
  /** Height in pixels. */
  h: number
  /** Resize fit mode. */
  fit: 'cover' | 'inside' | 'contain'
  /** Output format. */
  format: 'webp' | 'jpeg' | 'png'
  /** Compression quality. */
  quality: number
}

/**
 * What `ensureThumbnail` answers.
 *
 * The legacy `'generated'` status is gone with the synchronous branch that
 * produced it (see `thumbnail-mutations.ts`). Callers that switched on
 * `status === 'ready' || status === 'generated'` collapse to `'ready'`.
 */
export type ThumbnailResult =
  | {
      status: 'ready'
      assetId: string
      assetVersionId: string
      storageLocationId: string
    }
  | { status: 'queued'; jobId: string }

/** Metadata the worker stamps on a generated thumbnail version. */
export interface ThumbnailMetadata {
  /** Requested dimensions. */
  dimensions: { width: number; height: number }
  /** Actual dimensions after processing. */
  actualDimensions: { width: number; height: number }
  /** Output format. */
  format: string
  /** Compression quality. */
  quality?: number
  /** Resize fit mode. */
  fit?: 'cover' | 'inside' | 'contain'
  /** When processing completed. */
  processedAt: Date
  /** Processing time in milliseconds. */
  processingTimeMs: number
  /** Source file size. */
  sourceSize: number
  /** Output file size. */
  outputSize: number
}

/** What the sharp pipeline hands back. Produced by `core/image-processing.ts`. */
export interface ProcessedThumbnail {
  buffer: Buffer
  size: number
  format: 'webp' | 'jpeg' | 'png'
  dimensions: { width: number; height: number }
  actualDimensions: { width: number; height: number }
  quality: number
  fit: 'cover' | 'inside' | 'contain'
  metadata: {
    originalWidth: number
    originalHeight: number
    dimensions: { width: number | 'auto'; height: number | 'auto' }
    actualDimensions: { width: number; height: number }
  }
}

/**
 * The thumbnail queue's job payload.
 *
 * `key` is {@link thumbnailJobKey}'s output, and the worker uses it to release
 * the enqueue latch — so a producer that invents its own `key` silently strands
 * the latch for 60 seconds. Build it with {@link thumbnailJobKey}, always.
 */
export interface GenerateThumbnailPayload {
  orgId: string
  userId: string
  versionId: string
  preset: string
  opts: ThumbnailOptions
  key: string
  visibility?: 'PUBLIC' | 'PRIVATE'
}

/** Sizing and format for every preset. */
export const THUMBNAIL_PRESETS: Record<PresetKey, PresetConfig> = {
  // Avatar presets (square, cover fit, WebP for efficiency)
  'avatar-32': { w: 32, h: 32, fit: 'cover', format: 'webp', quality: 90 },
  'avatar-64': { w: 64, h: 64, fit: 'cover', format: 'webp', quality: 90 },
  'avatar-128': { w: 128, h: 128, fit: 'cover', format: 'webp', quality: 85 },
  'avatar-256': { w: 256, h: 256, fit: 'cover', format: 'webp', quality: 85 },

  // Article presets (JPEG for compatibility)
  'article-thumb': { w: 200, h: 150, fit: 'cover', format: 'jpeg', quality: 85 },
  'article-cover': { w: 800, h: 400, fit: 'cover', format: 'jpeg', quality: 85 },
  'article-inline': { w: 600, h: 600, fit: 'inside', format: 'jpeg', quality: 90 },

  // Attachment previews (PNG for quality)
  'attachment-preview': { w: 400, h: 400, fit: 'inside', format: 'png', quality: 100 },
  'attachment-thumb': { w: 150, h: 150, fit: 'cover', format: 'webp', quality: 85 },

  // Comment attachment previews (WebP for efficiency)
  'comment-preview': { w: 200, h: 200, fit: 'cover', format: 'webp', quality: 85 },
  'comment-preview-large': { w: 400, h: 300, fit: 'inside', format: 'webp', quality: 90 },

  // Knowledge Base logos (preserve aspect ratio and transparency)
  'kb-logo-sm': { w: 200, h: 60, fit: 'inside', format: 'png', quality: 100 },
  'kb-logo-lg': { w: 400, h: 120, fit: 'inside', format: 'png', quality: 100 },
} as const

/** Preset used when a caller names none. */
export const DEFAULT_PRESET: PresetKey = 'avatar-64'

/** Guard rails for the sharp pipeline. */
export const THUMBNAIL_LIMITS = {
  maxInputSize: 50 * 1024 * 1024, // 50MB
  maxInputPixels: 16384 * 16384, // ~268 megapixels
  maxProcessingTime: 30000, // 30 seconds
  maxConcurrentJobs: 10, // Per organization
} as const

/**
 * Allowed MIME types for thumbnail generation.
 *
 * ICO and SVG can't be decoded by sharp directly — the pipeline's
 * `normalizeImageSource` step decodes/rasterizes them to PNG before resize, so
 * they're accepted as source types here (and re-admitted at remote-image
 * ingestion). SVG is detected via a text sniff since it has no magic bytes.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/tiff',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const

/** Whether a string names a preset this build knows how to render. */
export function isPresetKey(preset: string): preset is PresetKey {
  return Object.hasOwn(THUMBNAIL_PRESETS, preset)
}

/**
 * Narrow a caller-supplied preset, or refuse.
 *
 * The legacy service indexed `THUMBNAIL_PRESETS[preset as PresetKey]` and read
 * `.format` off the result, so an unknown preset produced a `TypeError` on
 * `undefined` — a 500 with no useful message. `enqueueEnsureThumbnail` threw a
 * bare `Error`. Both become one `BadRequestError` the router maps to 400.
 *
 * @throws {BadRequestError} when the preset is not in {@link THUMBNAIL_PRESETS}.
 */
export function assertPresetKey(preset: string): PresetKey {
  if (!isPresetKey(preset)) {
    throw new BadRequestError(`Invalid thumbnail preset: ${preset}`)
  }
  return preset
}

/** The MIME type an output format is served as. */
export function mimeTypeForFormat(format: PresetConfig['format']): string {
  switch (format) {
    case 'webp':
      return 'image/webp'
    case 'png':
      return 'image/png'
    default:
      return 'image/jpeg'
  }
}

/**
 * The content identity of one thumbnail request, as a 16-hex-char digest.
 *
 * Two calls that would produce byte-identical output share a key, and therefore
 * share a BullMQ job id and an enqueue latch. See the file header for what is in
 * the hash and what is deliberately left out.
 *
 * @param sourceVersionId The `MediaAssetVersion` the thumbnail derives from.
 * @param preset Which preset to render.
 * @param opts Format/quality overrides. Anything absent falls back to the preset.
 */
export function thumbnailJobKey(
  sourceVersionId: string,
  preset: PresetKey,
  opts: ThumbnailOptions = {}
): string {
  const config = THUMBNAIL_PRESETS[preset]
  const params = JSON.stringify({
    versionId: sourceVersionId,
    preset,
    format: opts.format ?? config.format,
    quality: opts.quality ?? config.quality,
  })
  return createHash('sha256').update(params).digest('hex').slice(0, 16)
}

/**
 * The BullMQ job id for a key.
 *
 * Deterministic on purpose: BullMQ refuses a second job with an id that is
 * already waiting or active, which is the queue-level half of the deduplication
 * (the Redis latch in `storage/queue-port.ts` is the other half, covering the
 * window after a job completes and its id is released).
 */
export function thumbnailJobId(key: string): string {
  return `thumb-${key}`
}

/**
 * The Redis key holding the in-flight job id for a thumbnail key.
 *
 * Written by the production `QueuePort` at enqueue time and deleted by the
 * worker on both its success and failure paths. The string shape is pinned by
 * that pairing — change it here and both sides move together, which is the whole
 * reason it is a function.
 */
export function thumbnailLatchKey(key: string): string {
  return `processing:${thumbnailJobId(key)}`
}
