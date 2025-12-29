// packages/lib/src/datasets/extractors/base-extractor.ts

import { createScopedLogger } from '@auxx/logger'
import type {
  ExtractorMetadata,
  ExtractionResult,
  ExtractionOptions,
  ExtractorCapabilities,
} from '../types/extractor.types'

const logger = createScopedLogger('base-extractor')

export abstract class BaseExtractor {
  protected fileContent: Buffer
  protected identifier?: string
  protected cacheKey?: string
  protected options: ExtractionOptions

  constructor(
    fileContent: Buffer,
    identifier?: string,
    cacheKey?: string,
    options: ExtractionOptions = {}
  ) {
    this.fileContent = fileContent
    this.identifier = identifier
    this.cacheKey = cacheKey
    this.options = {
      preserveFormatting: false,
      extractImages: false,
      ocrEnabled: false,
      maxContentLength: 10 * 1024 * 1024, // 10MB
      timeout: 30000, // 30 seconds
      ...options,
    }
  }

  /**
   * Extract content from the file
   */
  abstract extract(): Promise<ExtractionResult>

  /**
   * Check if this extractor supports the file type
   */
  abstract supports(mimeType: string, extension: string): boolean

  /**
   * Get the priority of this extractor for the given file type
   * Higher number = higher priority
   */
  abstract getPriority(mimeType: string, extension: string): number

  /**
   * Get the name of this extractor
   */
  abstract getName(): string

  /**
   * Get supported file types
   */
  abstract getSupportedTypes(): ExtractorCapabilities

  /**
   * Normalize extension to always have leading dot
   * Handles both "md" and ".md" formats consistently
   */
  protected normalizeExtension(extension: string): string {
    if (!extension) return ''
    return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  }

  /**
   * Validate extracted content
   */
  protected validateContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new Error('Extracted content is empty')
    }

    if (this.options.maxContentLength && content.length > this.options.maxContentLength) {
      logger.warn('Content exceeds maximum length, truncating', {
        originalLength: content.length,
        maxLength: this.options.maxContentLength,
      })

      throw new Error(`Content too large: ${content.length} > ${this.options.maxContentLength}`)
    }
  }

  /**
   * Count words in text
   */
  protected countWords(text: string): number {
    if (!text || text.trim().length === 0) return 0
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length
  }

  /**
   * Clean text content with minimal normalization.
   * Only normalizes line endings and removes control characters.
   * Whitespace normalization is handled by DocumentProcessor.cleanContent()
   * based on user's preprocessing settings.
   */
  protected cleanText(text: string): string {
    if (!text) return ''

    // 1. Normalize line endings (Windows/Mac → Unix)
    text = text.replace(/\r\n/g, '\n')
    text = text.replace(/\r/g, '\n')

    // 2. Remove control characters (except newlines, tabs, spaces)
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

    // 3. DO NOT normalize whitespace here - let DocumentProcessor handle it
    //    based on user's preprocessing settings (normalizeWhitespace option)

    return text.trim()
  }

  /**
   * Create metadata object
   */
  protected createMetadata(
    format: string,
    additional: Partial<ExtractorMetadata> = {}
  ): ExtractorMetadata {
    return {
      format,
      extractedAt: new Date(),
      extractorName: this.getName(),
      ...additional,
    }
  }

  /**
   * Handle extraction timeout
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs || this.options.timeout || 30000

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Extraction timeout after ${timeout}ms`))
      }, timeout)

      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeoutId))
    })
  }

  /**
   * Log extraction metrics
   */
  protected logExtractionMetrics(result: ExtractionResult): void {
    logger.info('Content extraction completed', {
      extractor: this.getName(),
      contentLength: result.content.length,
      wordCount: result.wordCount,
      processingTime: result.processingTime,
      identifier: this.identifier,
    })
  }
}
