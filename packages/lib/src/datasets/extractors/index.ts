// packages/lib/src/datasets/extractors/index.ts

// Export base classes
export { BaseExtractor } from './base-extractor'
export { ExtractorRegistry } from './extractor-registry'
export { ExtractorFactory } from './extractor-factory'

// Export specific extractors
export { TextExtractor } from './text-extractor'
export { PdfExtractor } from './pdf-extractor'
export { DocxExtractor } from './docx-extractor'
export { HtmlExtractor } from './html-extractor'

// Re-export types for convenience
export type * from '../types/extractor.types'
