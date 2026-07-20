// packages/lib/src/files/core/image-processing.ts

import { createRequire } from 'node:module'
import { fileTypeFromBuffer } from 'file-type'
import { createScopedLogger } from '../../logger'
import type { PresetKey, ProcessedThumbnail } from './thumbnail-types'
import { ALLOWED_IMAGE_TYPES, THUMBNAIL_LIMITS, THUMBNAIL_PRESETS } from './thumbnail-types'

const logger = createScopedLogger('image-processing')

/**
 * Thrown when source bytes are not a thumbnailable image type (unknown or
 * unsupported format). Deterministic — callers should treat it as a soft skip
 * rather than a retryable failure.
 */
export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedImageError'
  }
}

/** Bounded max dimension for the rasterized SVG (covers avatar-256, crisp). */
const MAX_SVG_RENDER_DIM = 512

/**
 * Cheap textual sniff for SVG. `file-type` can't detect SVG (it's text, not
 * binary), so we look for an `<svg` root in the first ~1 KB, tolerating a BOM,
 * an XML declaration, comments, and a doctype ahead of it.
 */
export function isSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString('utf8').replace(/^﻿/, '')
  const stripped = head
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .trimStart()
  return /^<svg[\s>]/i.test(stripped)
}

/**
 * Detect an image's MIME type from its bytes. Magic-byte detection via
 * `file-type` first, falling back to the SVG text sniff. Shared by
 * `validateSource` and the remote-image ingestion allowlist so both agree.
 */
export async function detectImageType(buffer: Buffer): Promise<string | undefined> {
  const fileType = await fileTypeFromBuffer(buffer)
  if (fileType) return fileType.mime
  return isSvg(buffer) ? 'image/svg+xml' : undefined
}

/** Result of {@link normalizeImageSource}. */
export interface NormalizedImageSource {
  /** A sharp-readable raster buffer (PNG for ICO/SVG, original bytes otherwise). */
  buffer: Buffer
  /** MIME type of {@link buffer} (`image/png` for the normalized cases). */
  mime: string
  /** Set when the source was decoded/rasterized from a non-sharp format. */
  normalizedFrom?: 'ico' | 'svg'
}

/**
 * Canonical decode/normalize step. Maps any accepted source buffer into a
 * sharp-readable raster **before** validation/resize:
 *
 * - ICO (`image/x-icon`) → decode → best frame → PNG (sharp can't decode ICO)
 * - SVG (`image/svg+xml`) → sanitize → rasterize → PNG (fetch-free renderer)
 * - anything else → passthrough
 *
 * Run this in front of {@link validateSource}/{@link processImage} so the rest
 * of the pipeline only ever sees formats sharp can read.
 */
export async function normalizeImageSource(buffer: Buffer): Promise<NormalizedImageSource> {
  const mime = await detectImageType(buffer)
  if (!mime) {
    throw new UnsupportedImageError('Unable to determine file type from content')
  }

  if (mime === 'image/svg+xml') {
    return { buffer: await rasterizeSvgToPng(buffer), mime: 'image/png', normalizedFrom: 'svg' }
  }

  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') {
    return { buffer: await decodeIcoToPng(buffer), mime: 'image/png', normalizedFrom: 'ico' }
  }

  return { buffer, mime }
}

/** Lazily-created headless DOMPurify instance (server-side, no DOM). */
// biome-ignore lint/suspicious/noExplicitAny: DOMPurify's headless instance type is awkward to name.
let domPurify: any = null

async function getDomPurify() {
  if (!domPurify) {
    const { JSDOM } = await import('jsdom')
    const createDOMPurify = (await import('dompurify')).default
    domPurify = createDOMPurify(new JSDOM('').window as unknown as Window)
  }
  return domPurify
}

/**
 * Harden an untrusted SVG before rasterization. XSS is a browser threat; OUR
 * risk is SSRF / local-file read via external references (enrichment rasterizes
 * SVGs fetched from arbitrary company websites), so we go beyond the default
 * SVG profile and forbid resource-loading tags/attrs.
 */
async function sanitizeSvg(svg: string): Promise<string> {
  const DOMPurify = await getDomPurify()
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'use'],
    FORBID_ATTR: ['href', 'xlink:href'], // no external/self resource refs
  })
}

/**
 * Sanitize + rasterize an SVG to PNG using `@resvg/resvg-js` — a static
 * renderer with no script execution and no remote fetch, so even a sanitizer
 * miss can't reach the network/filesystem. Bounds the larger side to
 * {@link MAX_SVG_RENDER_DIM} to cap output pixels.
 */
async function rasterizeSvgToPng(buffer: Buffer): Promise<Buffer> {
  const sanitized = await sanitizeSvg(buffer.toString('utf8'))
  if (!/<svg[\s>]/i.test(sanitized)) {
    throw new UnsupportedImageError('SVG had no renderable content after sanitization')
  }

  // Bundler-opaque load: Turbopack can't place resvg's native .node binding in
  // ESM chunks, and externalizing it via serverExternalPackages trips a
  // separate Turbopack bug. The joined specifier keeps the require invisible
  // to static analysis (tsdown AND Turbopack), which also hides it from file
  // tracing — the app Dockerfiles copy the package into the runtime image.
  const nodeRequire = createRequire(import.meta.url)
  const { Resvg } = nodeRequire(
    ['@resvg', 'resvg-js'].join('/')
  ) as typeof import('@resvg/resvg-js')

  // Probe intrinsic size so we can constrain the larger side (keeps aspect
  // ratio and prevents an extreme viewBox from blowing up the raster).
  const probe = new Resvg(sanitized)
  const mode: 'width' | 'height' = probe.width >= probe.height ? 'width' : 'height'

  const resvg = new Resvg(sanitized, { fitTo: { mode, value: MAX_SVG_RENDER_DIM } })
  return Buffer.from(resvg.render().asPng())
}

/**
 * Decode an ICO container and re-encode its best frame as PNG (sharp/libvips
 * can't decode ICO). Picks the largest-area frame and guards against
 * empty/corrupt/oversized inputs.
 */
async function decodeIcoToPng(buffer: Buffer): Promise<Buffer> {
  const decodeIco = (await import('decode-ico')).default

  // decode-ico frames are one of two kinds: `png` frames carry the raw PNG file
  // bytes in `data`; `bmp` frames carry decoded RGBA pixels. `bpp` is the source
  // bit depth (used only as a tie-break).
  type IcoFrame = {
    width: number
    height: number
    type: 'png' | 'bmp'
    bpp?: number
    data: Uint8ClampedArray
  }

  let frames: IcoFrame[]
  try {
    frames = decodeIco(buffer) as IcoFrame[]
  } catch (error) {
    throw new UnsupportedImageError(
      `Failed to decode ICO: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  }

  if (!frames || frames.length === 0) {
    throw new UnsupportedImageError('ICO contains no frames')
  }

  // Largest area wins (favours the highest-resolution icon variant), tie-broken
  // on higher bit depth.
  const best = frames.reduce((a, b) => {
    const areaA = a.width * a.height
    const areaB = b.width * b.height
    if (areaB !== areaA) return areaB > areaA ? b : a
    return (b.bpp ?? 0) > (a.bpp ?? 0) ? b : a
  })

  const pixels = best.width * best.height
  if (!pixels) {
    throw new UnsupportedImageError('ICO frame has zero dimensions')
  }
  if (pixels > THUMBNAIL_LIMITS.maxInputPixels) {
    throw new UnsupportedImageError(`ICO frame too large: ${pixels} pixels`)
  }

  const bytes = Buffer.from(best.data.buffer, best.data.byteOffset, best.data.byteLength)
  const sharp = (await import('sharp')).default

  // `png` frames are already an encoded image sharp can read directly; `bmp`
  // frames are raw RGBA and need the dimensions passed in.
  const pipeline =
    best.type === 'png'
      ? sharp(bytes, { limitInputPixels: THUMBNAIL_LIMITS.maxInputPixels })
      : sharp(bytes, {
          raw: { width: best.width, height: best.height, channels: 4 },
          limitInputPixels: THUMBNAIL_LIMITS.maxInputPixels,
        })

  return pipeline.png().toBuffer()
}

/**
 * Validate source image buffer
 */
export async function validateSource(
  buffer: Buffer,
  declaredMimeType?: string | null
): Promise<void> {
  // Check size limit
  if (buffer.length > THUMBNAIL_LIMITS.maxInputSize) {
    throw new Error(
      `Input file too large: ${buffer.length} bytes (max: ${THUMBNAIL_LIMITS.maxInputSize})`
    )
  }

  // Detect actual file type (magic bytes, with SVG text-sniff fallback)
  const detectedMime = await detectImageType(buffer)
  if (!detectedMime) {
    throw new UnsupportedImageError('Unable to determine file type from content')
  }

  // Log mismatch but don't fail
  if (declaredMimeType && detectedMime !== declaredMimeType) {
    logger.warn('MIME type mismatch detected', {
      declared: declaredMimeType,
      detected: detectedMime,
    })
  }

  // Check if image type is supported
  if (!ALLOWED_IMAGE_TYPES.includes(detectedMime as any)) {
    throw new UnsupportedImageError(`Unsupported image type: ${detectedMime}`)
  }

  // Get image metadata to check pixel limits
  try {
    // Dynamic import sharp only when needed
    const sharp = (await import('sharp')).default
    const metadata = await sharp(buffer, {
      limitInputPixels: THUMBNAIL_LIMITS.maxInputPixels,
    }).metadata()

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to read image dimensions')
    }

    // Check if dimensions are within limits
    const pixels = metadata.width * metadata.height
    if (pixels > THUMBNAIL_LIMITS.maxInputPixels) {
      throw new Error(`Image too large: ${pixels} pixels (max: ${THUMBNAIL_LIMITS.maxInputPixels})`)
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Input image exceeds pixel limit')) {
        throw new Error(`Image exceeds pixel limit of ${THUMBNAIL_LIMITS.maxInputPixels} pixels`)
      }
      throw error
    }
    throw new Error('Failed to read image metadata')
  }
}

/**
 * Process image into thumbnail according to preset
 *
 * IMPORTANT: The preset determines format and quality.
 * Any opts.format or opts.quality are ignored to maintain DB uniqueness.
 */
export async function processImage(
  buffer: Buffer,
  preset: PresetKey,
  opts: { queue?: boolean } = {}
): Promise<ProcessedThumbnail> {
  const presetConfig = THUMBNAIL_PRESETS[preset]
  if (!presetConfig) {
    throw new Error(`Invalid preset: ${preset}`)
  }

  // Always use preset format and quality (ignore opts overrides)
  const format = presetConfig.format
  const quality = presetConfig.quality

  // Dynamic import sharp only when needed
  const sharp = (await import('sharp')).default

  // Create sharp instance
  let pipeline = sharp(buffer, {
    limitInputPixels: THUMBNAIL_LIMITS.maxInputPixels,
    failOn: 'warning', // Fail on corrupted images
  })

  // Get original metadata
  const metadata = await pipeline.metadata()
  const originalWidth = metadata.width || 0
  const originalHeight = metadata.height || 0

  const width: 'auto' | number = presetConfig.w
  const height: 'auto' | number = presetConfig.h
  // Calculate target dimensions
  // const { width, height } = presetConfig.dimensions
  const targetWidth = width === 'auto' ? undefined : width
  const targetHeight = height === 'auto' ? undefined : height

  // Apply auto-rotation based on EXIF orientation, then remove all metadata
  pipeline = pipeline
    .rotate() // Auto-rotate based on EXIF orientation
    // .removeMetadata() // Already removes metadata.
    .resize(targetWidth, targetHeight, {
      fit: presetConfig.fit,
      withoutEnlargement: true, // Don't upscale
      background: { r: 255, g: 255, b: 255, alpha: 0 }, // Transparent background for padding
    })

  // Apply format-specific options
  if (format === 'webp') {
    pipeline = pipeline.webp({
      quality,
      effort: 4, // Balance between speed and compression (0-6)
      smartSubsample: true,
    })
  } else if (format === 'jpeg') {
    pipeline = pipeline.jpeg({
      quality,
      progressive: true,
      mozjpeg: true, // Use mozjpeg encoder for better compression
    })
  } else if (format === 'png') {
    pipeline = pipeline.png({
      quality,
      compressionLevel: 9, // Max compression
      progressive: true,
    })
  }

  // Process the image
  const processedBuffer = await pipeline.toBuffer({ resolveWithObject: true })

  // Calculate actual dimensions after processing
  const actualWidth = processedBuffer.info.width
  const actualHeight = processedBuffer.info.height

  return {
    buffer: processedBuffer.data,
    size: processedBuffer.data.length,
    format: processedBuffer.info.format as 'webp' | 'jpeg' | 'png',
    dimensions: {
      width: targetWidth || 0,
      height: targetHeight || 0,
    },
    actualDimensions: {
      width: actualWidth,
      height: actualHeight,
    },
    quality,
    fit: presetConfig.fit,
    metadata: {
      originalWidth,
      originalHeight,
      dimensions: { width: presetConfig.w, height: presetConfig.h },
      actualDimensions: {
        width: actualWidth,
        height: actualHeight,
      },
    },
  }
}

/**
 * Get MIME type for image format
 */
export function getMimeTypeForFormat(format: 'webp' | 'jpeg' | 'png'): string {
  switch (format) {
    case 'webp':
      return 'image/webp'
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}
