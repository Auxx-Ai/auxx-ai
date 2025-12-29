// packages/lib/src/datasets/types/extractor.types.ts

export interface ExtractorMetadata {
  format: string
  title?: string
  author?: string
  pageCount?: number
  language?: string
  wordCount?: number
  createdDate?: Date
  modifiedDate?: Date
  encoding?: string
  warnings?: string[]
  extractedAt?: Date
  extractorName?: string
  [key: string]: any
}

export interface ExtractionResult {
  content: string
  wordCount: number
  metadata: ExtractorMetadata
  processingTime?: number
  extractorUsed?: string
}

export interface ExtractionOptions {
  preserveFormatting?: boolean
  extractImages?: boolean
  ocrEnabled?: boolean
  maxContentLength?: number
  timeout?: number
}

export interface ExtractorCapabilities {
  mimeTypes: string[]
  extensions: string[]
  maxFileSize?: number
  requiresNetwork?: boolean
  supportsOCR?: boolean
  supportsImages?: boolean
}

export interface ExtractorInfo {
  name: string
  priority: number
  capabilities: ExtractorCapabilities
  isAvailable: boolean
}
