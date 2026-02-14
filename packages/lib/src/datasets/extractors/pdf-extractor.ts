// packages/lib/src/datasets/extractors/pdf-extractor.ts

import type { ExtractionResult, ExtractorCapabilities } from '../types/extractor.types'
// import pdfParse from 'pdf-parse'
import { BaseExtractor } from './base-extractor'
import { ExtractorRegistry } from './extractor-registry'

/**
 * PDF extractor using pdf-parse library
 */
export class PdfExtractor extends BaseExtractor {
  getName(): string {
    return 'pdf-extractor'
  }

  supports(mimeType: string, extension: string): boolean {
    const normalizedExt = this.normalizeExtension(extension)
    return mimeType === 'application/pdf' || normalizedExt === '.pdf'
  }

  getPriority(mimeType: string, extension: string): number {
    // High priority for PDF files
    const normalizedExt = this.normalizeExtension(extension)
    if (mimeType === 'application/pdf' || normalizedExt === '.pdf') {
      return 95
    }
    return 0
  }

  getSupportedTypes(): ExtractorCapabilities {
    return {
      mimeTypes: ['application/pdf'],
      extensions: ['.pdf'],
      maxFileSize: 100 * 1024 * 1024, // 100MB for PDFs
      requiresNetwork: false,
      supportsOCR: false, // pdf-parse doesn't do OCR, just extracts text
      supportsImages: false,
    }
  }

  async extract(): Promise<ExtractionResult> {
    const startTime = Date.now()

    try {
      // Use the fileContent Buffer directly (already available)
      const buffer = this.fileContent

      // Parse PDF with timeout
      const pdfData = await this.withTimeout(this.parsePdf(buffer), this.options.timeout)

      // Extract and clean text content
      let content = pdfData.text || ''
      content = this.cleanText(content)

      // Validate content
      this.validateContent(content)

      // Count words
      const wordCount = this.countWords(content)

      // Create metadata
      const metadata = this.createMetadata('pdf', {
        title: this.extractTitle(pdfData.info),
        author: this.extractAuthor(pdfData.info),
        pageCount: pdfData.numpages,
        createdDate: this.extractCreatedDate(pdfData.info),
        modifiedDate: this.extractModifiedDate(pdfData.info),
        producer: pdfData.info?.Producer,
        creator: pdfData.info?.Creator,
        pdfVersion: pdfData.version,
        encrypted: pdfData.info?.IsAcroFormPresent === 'true',
        hasFormFields: pdfData.info?.IsAcroFormPresent === 'true',
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
        `PDF extraction failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Parse PDF using pdf-parse with options
   */
  private async parsePdf(buffer: Buffer) {
    const options = {
      // Increase memory limit for large PDFs
      max: this.options.maxContentLength || 50 * 1024 * 1024,

      // Custom text extraction options
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    }

    try {
      // Dynamically import pdf-parse
      const pdfParseModule = await import('pdf-parse')
      const pdfParse = pdfParseModule.default || pdfParseModule
      return await pdfParse(buffer, options)
    } catch (error) {
      // Handle common PDF parsing errors
      if (error instanceof Error) {
        if (error.message.includes('Invalid PDF')) {
          throw new Error('Invalid or corrupted PDF file')
        }
        if (error.message.includes('password')) {
          throw new Error('PDF is password protected')
        }
        if (error.message.includes('memory')) {
          throw new Error('PDF file too large or complex to process')
        }
      }

      throw new Error(
        `PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Extract title from PDF info
   */
  private extractTitle(info: any): string | undefined {
    if (!info) return undefined

    return info.Title || info.title || undefined
  }

  /**
   * Extract author from PDF info
   */
  private extractAuthor(info: any): string | undefined {
    if (!info) return undefined

    return info.Author || info.author || info.Creator || info.creator || undefined
  }

  /**
   * Extract creation date from PDF info
   */
  private extractCreatedDate(info: any): Date | undefined {
    if (!info) return undefined

    const dateStr = info.CreationDate || info.creationDate
    if (!dateStr) return undefined

    try {
      // PDF dates are in format: D:YYYYMMDDHHmmSSOHH'mm'
      if (typeof dateStr === 'string' && dateStr.startsWith('D:')) {
        const cleanDate = dateStr.substring(2, 16) // Extract YYYYMMDDHHMMSS
        const year = parseInt(cleanDate.substring(0, 4))
        const month = parseInt(cleanDate.substring(4, 6)) - 1 // JS months are 0-indexed
        const day = parseInt(cleanDate.substring(6, 8))
        const hour = parseInt(cleanDate.substring(8, 10)) || 0
        const minute = parseInt(cleanDate.substring(10, 12)) || 0
        const second = parseInt(cleanDate.substring(12, 14)) || 0

        return new Date(year, month, day, hour, minute, second)
      }

      // Try parsing as regular date
      return new Date(dateStr)
    } catch (error) {
      return undefined
    }
  }

  /**
   * Extract modification date from PDF info
   */
  private extractModifiedDate(info: any): Date | undefined {
    if (!info) return undefined

    const dateStr = info.ModDate || info.modDate || info.ModificationDate
    if (!dateStr) return undefined

    return this.extractCreatedDate({ CreationDate: dateStr })
  }
}

// Auto-register this extractor
ExtractorRegistry.register(PdfExtractor)
