// packages/lib/src/files/core/image-processing.ts

import { fileTypeFromBuffer } from 'file-type'
import { createScopedLogger } from '../../logger'
import type { PresetKey, ProcessedThumbnail } from './thumbnail-types'
import { ALLOWED_IMAGE_TYPES, THUMBNAIL_LIMITS, THUMBNAIL_PRESETS } from './thumbnail-types'

const logger = createScopedLogger('image-processing')

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

  // Detect actual file type from magic bytes
  const fileType = await fileTypeFromBuffer(buffer)
  if (!fileType) {
    throw new Error('Unable to determine file type from content')
  }

  // Log mismatch but don't fail
  if (declaredMimeType && fileType.mime !== declaredMimeType) {
    logger.warn('MIME type mismatch detected', {
      declared: declaredMimeType,
      detected: fileType.mime,
    })
  }

  // Check if image type is supported
  if (!ALLOWED_IMAGE_TYPES.includes(fileType.mime as any)) {
    throw new Error(`Unsupported image type: ${fileType.mime}`)
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
