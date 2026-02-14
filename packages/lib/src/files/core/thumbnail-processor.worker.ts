// packages/lib/src/files/core/thumbnail-processor.worker.ts
// Worker-only processing entrypoint for thumbnail generation.
// This module imports image-processing primitives that may transitively load sharp.

export { getMimeTypeForFormat, processImage, validateSource } from './image-processing'
