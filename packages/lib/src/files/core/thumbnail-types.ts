// packages/lib/src/files/core/thumbnail-types.ts

/**
 * Source for thumbnail generation
 */
export type ThumbnailSource =
  | { type: 'asset'; assetId: string; assetVersionId?: string }
  | { type: 'file'; fileId: string; fileVersionId?: string }
  | { type: 'attachment'; attachmentId: string }

/**
 * Thumbnail generation options
 */
export interface ThumbnailOptions {
  /** Preset to use for sizing and format */
  preset?: PresetKey
  /** Queue for background processing (default true) */
  queue?: boolean
  /** Override format from preset */
  format?: 'webp' | 'jpeg' | 'png'
  /** Override quality from preset */
  quality?: number
  /** Visibility setting (default inherit from source) */
  visibility?: 'PUBLIC' | 'PRIVATE'
  /** Update user.image field when thumbnail is ready (for avatar processing) */
  updateUser?: boolean
}

/**
 * Available thumbnail presets
 */
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

/**
 * Preset configuration
 */
export interface PresetConfig {
  /** Width in pixels */
  w: number
  /** Height in pixels */
  h: number
  /** Resize fit mode */
  fit: 'cover' | 'inside' | 'contain'
  /** Output format */
  format: 'webp' | 'jpeg' | 'png'
  /** Compression quality */
  quality: number
}

/**
 * Result of thumbnail operation
 */
export type ThumbnailResult =
  | {
      status: 'ready' | 'generated'
      assetId: string
      assetVersionId: string
      storageLocationId: string
      url?: string
    }
  | { status: 'queued'; jobId: string }

/**
 * Thumbnail metadata stored in JSON
 */
export interface ThumbnailMetadata {
  /** Requested dimensions */
  dimensions: { width: number; height: number }
  /** Actual dimensions after processing */
  actualDimensions: { width: number; height: number }
  /** Output format */
  format: string
  /** Compression quality */
  quality?: number
  /** Resize fit mode */
  fit?: 'cover' | 'inside' | 'contain'
  /** When processing completed */
  processedAt: Date
  /** Processing time in milliseconds */
  processingTimeMs: number
  /** Source file size */
  sourceSize: number
  /** Output file size */
  outputSize: number
}

/**
 * Processed thumbnail data
 */
export interface ProcessedThumbnail {
  buffer: Buffer
  size: number
  format: 'webp' | 'jpeg' | 'png'
  dimensions: { width: number; height: number }
  actualDimensions: { width: number; height: number }
  quality: number
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  metadata: {
    originalWidth: number
    originalHeight: number
    dimensions: { width: number | 'auto'; height: number | 'auto' }
    actualDimensions: { width: number; height: number }
  }
}

/**
 * Set of thumbnails generated together
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

/**
 * Job payload for background processing
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

/**
 * Thumbnail service configuration
 */
export interface ThumbnailServiceConfig {
  /** Maximum input file size in bytes */
  maxInputSize?: number
  /** Maximum input pixels to prevent decompression bombs */
  maxInputPixels?: number
  /** Maximum processing time in milliseconds */
  maxProcessingTime?: number
  /** Maximum concurrent jobs per organization */
  maxConcurrentJobs?: number
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Thumbnail presets configuration
 */
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

/**
 * Default limits for thumbnail processing
 */
export const THUMBNAIL_LIMITS = {
  maxInputSize: 50 * 1024 * 1024, // 50MB
  maxInputPixels: 16384 * 16384, // ~268 megapixels
  maxProcessingTime: 30000, // 30 seconds
  maxConcurrentJobs: 10, // Per organization
} as const

/**
 * Allowed MIME types for thumbnail generation
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/tiff',
  'image/bmp',
] as const
