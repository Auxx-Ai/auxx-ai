// packages/lib/src/datasets/extractors/text-extractor.ts

import { BaseExtractor } from './base-extractor'
import { ExtractorRegistry } from './extractor-registry'
import type { ExtractionResult, ExtractorCapabilities } from '../types/extractor.types'

/**
 * Plain text extractor for .txt, .md, .csv, .json and other text-based files
 */
export class TextExtractor extends BaseExtractor {
  getName(): string {
    return 'text-extractor'
  }

  supports(mimeType: string, extension: string): boolean {
    const capabilities = this.getSupportedTypes()
    const normalizedExt = this.normalizeExtension(extension)
    return (
      capabilities.mimeTypes.includes(mimeType) ||
      capabilities.extensions.includes(normalizedExt)
    )
  }

  getPriority(mimeType: string, extension: string): number {
    // High priority for text files
    const textTypes = ['text/plain', 'text/markdown', 'text/x-markdown', 'application/json']
    if (textTypes.includes(mimeType)) {
      return 90
    }

    const normalizedExt = this.normalizeExtension(extension)
    const textExtensions = ['.txt', '.md', '.json', '.csv']
    if (textExtensions.includes(normalizedExt)) {
      return 85
    }

    return 70 // Default priority for other supported types
  }

  getSupportedTypes(): ExtractorCapabilities {
    return {
      mimeTypes: [
        'text/plain',
        'text/markdown',
        'text/x-markdown',
        'text/csv',
        'application/json',
        'application/xml',
        'text/xml',
        'application/yaml',
        'text/yaml',
        'application/javascript',
        'text/javascript',
        'application/typescript',
        'text/css',
        'application/sql',
        'text/sql',
      ],
      extensions: [
        '.txt',
        '.md',
        '.markdown',
        '.csv',
        '.json',
        '.xml',
        '.yaml',
        '.yml',
        '.js',
        '.ts',
        '.tsx',
        '.jsx',
        '.css',
        '.scss',
        '.sass',
        '.sql',
        '.py',
        '.rb',
        '.php',
        '.go',
        '.rs',
        '.java',
        '.c',
        '.cpp',
        '.h',
        '.hpp',
      ],
      maxFileSize: 50 * 1024 * 1024, // 50MB for text files
      requiresNetwork: false,
      supportsOCR: false,
      supportsImages: false,
    }
  }

  async extract(): Promise<ExtractionResult> {
    const startTime = Date.now()

    try {
      // Use the fileContent Buffer directly (already available)
      const buffer = this.fileContent

      // Detect encoding and convert to string
      let content = this.decodeContent(buffer)

      // Clean and validate content
      content = this.cleanText(content)
      this.validateContent(content)

      // Count words
      const wordCount = this.countWords(content)

      // Detect language if possible
      const language = this.detectLanguage(content)

      // Create metadata
      const metadata = this.createMetadata('text', {
        encoding: this.detectEncoding(buffer),
        language,
        lineCount: content.split('\n').length,
        characterCount: content.length,
      })

      const processingTime = Date.now() - startTime

      const result: ExtractionResult = {
        content,
        wordCount,
        metadata,
        processingTime,
        extractorUsed: this.getName(),
      }

      this.logExtractionMetrics(result)
      return result
    } catch (error) {
      const processingTime = Date.now() - startTime

      throw new Error(
        `Text extraction failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Decode buffer content to string with encoding detection
   */
  private decodeContent(buffer: Buffer): string {
    // Try UTF-8 first
    try {
      const content = buffer.toString('utf8')
      // Check for invalid UTF-8 sequences
      if (!this.hasInvalidUTF8(content)) {
        return content
      }
    } catch (error) {
      // Fall back to other encodings
    }

    // Try other common encodings
    const encodings = ['latin1', 'ascii'] as const

    for (const encoding of encodings) {
      try {
        return buffer.toString(encoding)
      } catch (error) {
        continue
      }
    }

    // Last resort - use UTF-8 and replace invalid characters
    return buffer.toString('utf8').replace(/\uFFFD/g, '?')
  }

  /**
   * Check for invalid UTF-8 sequences
   */
  private hasInvalidUTF8(content: string): boolean {
    return content.includes('\uFFFD')
  }

  /**
   * Detect text encoding from buffer
   */
  private detectEncoding(buffer: Buffer): string {
    // Simple BOM detection
    if (buffer.length >= 3) {
      const bom = buffer.subarray(0, 3)
      if (bom[0] === 0xef && bom[1] === 0xbb && bom[2] === 0xbf) {
        return 'utf8-bom'
      }
    }

    if (buffer.length >= 2) {
      const bom = buffer.subarray(0, 2)
      if (bom[0] === 0xff && bom[1] === 0xfe) {
        return 'utf16le'
      }
      if (bom[0] === 0xfe && bom[1] === 0xff) {
        return 'utf16be'
      }
    }

    // Check if content looks like UTF-8
    try {
      const decoded = buffer.toString('utf8')
      if (!this.hasInvalidUTF8(decoded)) {
        return 'utf8'
      }
    } catch (error) {
      // Not UTF-8
    }

    return 'unknown'
  }

  /**
   * Simple language detection based on character patterns
   */
  private detectLanguage(content: string): string | undefined {
    if (!content || content.length < 50) {
      return undefined
    }

    // Very basic language detection
    const sample = content.substring(0, 1000).toLowerCase()

    // English indicators
    const englishWords = ['the', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'you', 'that']
    const englishCount = englishWords.reduce((count, word) => {
      return count + (sample.match(new RegExp(`\\b${word}\\b`, 'g'))?.length || 0)
    }, 0)

    if (englishCount > 5) {
      return 'en'
    }

    // Could extend with other languages
    return undefined
  }
}

// Auto-register this extractor
ExtractorRegistry.register(TextExtractor)
