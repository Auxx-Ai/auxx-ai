// packages/lib/src/datasets/extractors/index.ts

// Re-export types for convenience
export type * from '../types/extractor.types'
// Export base classes
export { BaseExtractor } from './base-extractor'
export { DocxExtractor } from './docx-extractor'
export { ExtractorFactory } from './extractor-factory'
export { ExtractorRegistry } from './extractor-registry'
export { HtmlExtractor } from './html-extractor'
export { PdfExtractor } from './pdf-extractor'
// Export specific extractors
export { TextExtractor } from './text-extractor'
