// packages/lib/src/datasets/extractors/docx-extractor.ts

import mammoth from 'mammoth'
import type { ExtractionResult, ExtractorCapabilities } from '../types/extractor.types'
import { BaseExtractor } from './base-extractor'
import { ExtractorRegistry } from './extractor-registry'

/**
 * DOCX extractor using mammoth library
 */
export class DocxExtractor extends BaseExtractor {
  getName(): string {
    return 'docx-extractor'
  }

  supports(mimeType: string, extension: string): boolean {
    const supportedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ]
    const supportedExtensions = ['.docx', '.doc']
    const normalizedExt = this.normalizeExtension(extension)

    return supportedMimeTypes.includes(mimeType) || supportedExtensions.includes(normalizedExt)
  }

  getPriority(mimeType: string, extension: string): number {
    const normalizedExt = this.normalizeExtension(extension)

    // High priority for DOCX files
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      normalizedExt === '.docx'
    ) {
      return 92
    }

    // Lower priority for legacy DOC files (limited support)
    if (mimeType === 'application/msword' || normalizedExt === '.doc') {
      return 75
    }

    return 0
  }

  getSupportedTypes(): ExtractorCapabilities {
    return {
      mimeTypes: [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ],
      extensions: ['.docx', '.doc'],
      maxFileSize: 50 * 1024 * 1024, // 50MB for DOCX files
      requiresNetwork: false,
      supportsOCR: false,
      supportsImages: this.options.extractImages || false,
    }
  }

  async extract(): Promise<ExtractionResult> {
    const startTime = Date.now()

    try {
      // Use the fileContent Buffer directly (already available)
      const buffer = this.fileContent

      // Extract content with timeout
      const extractionResult = await this.withTimeout(
        this.extractDocxContent(buffer),
        this.options.timeout
      )

      // Clean and validate content
      const content = this.cleanText(extractionResult.value)
      this.validateContent(content)

      // Count words
      const wordCount = this.countWords(content)

      // Process warnings
      const warnings = extractionResult.messages
        .filter((msg) => msg.type === 'warning')
        .map((msg) => msg.message)

      // Create metadata
      const metadata = this.createMetadata('docx', {
        warnings: warnings.length > 0 ? warnings : undefined,
        hasImages: extractionResult.messages.some(
          (msg) => msg.message.includes('image') || msg.message.includes('picture')
        ),
        extractionMethod: 'mammoth',
        preservedFormatting: this.options.preserveFormatting,
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
        `DOCX extraction failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Extract content from DOCX using mammoth
   */
  private async extractDocxContent(buffer: Buffer) {
    const options = {
      // Convert to plain text by default, or HTML if preserveFormatting is true
      convertImage: this.options.extractImages
        ? (mammoth as any).images.imgElement(this.handleImage.bind(this))
        : (mammoth as any).images.ignore,

      // Style mapping for better text extraction
      styleMap: this.options.preserveFormatting
        ? [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            'b => strong',
            'i => em',
          ]
        : undefined,

      // Include document relationships
      includeEmbeddedStyleMap: false,
      includeDefaultStyleMap: true,
    }

    try {
      if (this.options.preserveFormatting) {
        // Extract as HTML to preserve formatting
        return await mammoth.convertToHtml({ buffer }, options)
      } else {
        // Extract as plain text
        return await mammoth.extractRawText({ buffer })
      }
    } catch (error) {
      // Handle common DOCX parsing errors
      if (error instanceof Error) {
        if (error.message.includes('not a valid zip file')) {
          throw new Error('Invalid DOCX file format')
        }
        if (error.message.includes('password')) {
          throw new Error('DOCX file is password protected')
        }
        if (error.message.includes('corrupted')) {
          throw new Error('DOCX file appears to be corrupted')
        }
      }

      throw new Error(
        `DOCX parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Handle images during extraction
   */
  private handleImage(image: any): { src: string } {
    // For now, just create a placeholder
    // In a full implementation, you might save images to storage
    // and return their URLs

    const imageInfo = {
      contentType: image.contentType,
      size: image.read().length,
    }

    // Return placeholder or data URL
    if (this.options.extractImages) {
      // Convert to data URL for inline embedding
      const base64 = image.read().toString('base64')
      return {
        src: `data:${image.contentType};base64,${base64}`,
      }
    }

    return {
      src: `[Image: ${imageInfo.contentType}, ${imageInfo.size} bytes]`,
    }
  }

  /**
   * Clean HTML content if preserveFormatting was used
   */
  protected cleanText(text: string): string {
    if (!this.options.preserveFormatting) {
      return super.cleanText(text)
    }

    // If HTML formatting is preserved, do minimal cleaning
    // Remove excessive whitespace while preserving HTML structure
    return text
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Reduce multiple newlines
      .replace(/\s{2,}/g, ' ') // Reduce multiple spaces
      .trim()
  }
}

// Auto-register this extractor
ExtractorRegistry.register(DocxExtractor)
