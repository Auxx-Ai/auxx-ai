// packages/lib/src/files/core/thumbnail-processor.worker.ts
// Worker-only processing entrypoint for thumbnail generation.
// This module imports image-processing primitives that may transitively load sharp.

export {
  getMimeTypeForFormat,
  normalizeImageSource,
  processImage,
  UnsupportedImageError,
  validateSource,
} from './image-processing'
