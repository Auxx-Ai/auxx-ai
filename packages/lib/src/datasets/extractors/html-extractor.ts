// packages/lib/src/datasets/extractors/html-extractor.ts

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { BaseExtractor } from './base-extractor'
import { ExtractorRegistry } from './extractor-registry'
import type { ExtractionResult, ExtractorCapabilities } from '../types/extractor.types'

/**
 * HTML extractor using cheerio for parsing and turndown for markdown conversion
 */
export class HtmlExtractor extends BaseExtractor {
  private turndownService: TurndownService

  constructor(fileContent: Buffer, identifier?: string, cacheKey?: string, options = {}) {
    super(fileContent, identifier, cacheKey, options)

    // Initialize turndown service for HTML to Markdown conversion
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      linkStyle: 'inlined',
      emDelimiter: '_',
    })
  }

  getName(): string {
    return 'html-extractor'
  }

  supports(mimeType: string, extension: string): boolean {
    const supportedMimeTypes = ['text/html', 'application/xhtml+xml', 'text/xml', 'application/xml']
    const supportedExtensions = ['.html', '.htm', '.xhtml', '.xml']
    const normalizedExt = this.normalizeExtension(extension)

    return supportedMimeTypes.includes(mimeType) || supportedExtensions.includes(normalizedExt)
  }

  getPriority(mimeType: string, extension: string): number {
    const normalizedExt = this.normalizeExtension(extension)

    // High priority for HTML files
    if (mimeType === 'text/html' || normalizedExt === '.html') {
      return 88
    }

    // Medium priority for XHTML and XML
    if (
      ['application/xhtml+xml', 'text/xml', 'application/xml'].includes(mimeType) ||
      ['.xhtml', '.xml'].includes(normalizedExt)
    ) {
      return 82
    }

    return 0
  }

  getSupportedTypes(): ExtractorCapabilities {
    return {
      mimeTypes: ['text/html', 'application/xhtml+xml', 'text/xml', 'application/xml'],
      extensions: ['.html', '.htm', '.xhtml', '.xml'],
      maxFileSize: 25 * 1024 * 1024, // 25MB for HTML files
      requiresNetwork: false,
      supportsOCR: false,
      supportsImages: true,
    }
  }

  async extract(): Promise<ExtractionResult> {
    const startTime = Date.now()

    try {
      // Use the fileContent Buffer directly (already available)
      const buffer = this.fileContent

      // Decode HTML content
      const htmlContent = buffer.toString('utf8')

      // Parse and extract content with timeout
      const extractedContent = await this.withTimeout(
        this.extractHtmlContent(htmlContent),
        this.options.timeout
      )

      // Clean and validate content
      const content = this.cleanText(extractedContent.content)
      this.validateContent(content)

      // Count words
      const wordCount = this.countWords(content)

      // Create metadata
      const metadata = this.createMetadata('html', {
        title: extractedContent.title,
        description: extractedContent.description,
        language: extractedContent.language,
        encoding: this.detectEncoding(buffer),
        hasImages: extractedContent.hasImages,
        hasLinks: extractedContent.hasLinks,
        linkCount: extractedContent.linkCount,
        imageCount: extractedContent.imageCount,
        headingCount: extractedContent.headingCount,
        extractionMethod: this.options.preserveFormatting ? 'markdown' : 'text',
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
        `HTML extraction failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Extract content from HTML
   */
  private async extractHtmlContent(htmlContent: string) {
    try {
      const $ = cheerio.load(htmlContent)

      // Extract metadata
      const title = this.extractTitle($)
      const description = this.extractDescription($)
      const language = this.extractLanguage($)

      // Remove script and style elements
      $('script, style, noscript').remove()

      // Count elements before extraction
      const linkCount = $('a').length
      const imageCount = $('img').length
      const headingCount = $('h1, h2, h3, h4, h5, h6').length

      let content: string

      if (this.options.preserveFormatting) {
        // Convert to markdown to preserve structure
        const bodyHtml = $('body').length > 0 ? $('body').html() || '' : $.html()
        content = this.turndownService.turndown(bodyHtml)
      } else {
        // Extract plain text
        content = $('body').length > 0 ? $('body').text() : $.text()
      }

      return {
        content,
        title,
        description,
        language,
        hasImages: imageCount > 0,
        hasLinks: linkCount > 0,
        linkCount,
        imageCount,
        headingCount,
      }
    } catch (error) {
      throw new Error(
        `HTML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Extract title from HTML
   */
  private extractTitle($: cheerio.CheerioAPI): string | undefined {
    // Try multiple sources for title
    const title =
      $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="title"]').attr('content')

    return title || undefined
  }

  /**
   * Extract description from HTML
   */
  private extractDescription($: cheerio.CheerioAPI): string | undefined {
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content')

    return description?.trim() || undefined
  }

  /**
   * Extract language from HTML
   */
  private extractLanguage($: cheerio.CheerioAPI): string | undefined {
    const language =
      $('html').attr('lang') ||
      $('meta[http-equiv="content-language"]').attr('content') ||
      $('meta[name="language"]').attr('content')

    return language?.trim().toLowerCase() || undefined
  }

  /**
   * Simple encoding detection for HTML
   */
  private detectEncoding(buffer: Buffer): string {
    const htmlContent = buffer.toString('utf8', 0, Math.min(buffer.length, 1024))

    // Look for charset declaration in meta tags
    const charsetMatch = htmlContent.match(/charset=["']?([^"'\s>]+)/i)
    if (charsetMatch) {
      return charsetMatch[1].toLowerCase()
    }

    // Look for XML encoding declaration
    const xmlMatch = htmlContent.match(/encoding=["']?([^"'\s>]+)/i)
    if (xmlMatch) {
      return xmlMatch[1].toLowerCase()
    }

    return 'utf-8'
  }
}

// Auto-register this extractor
ExtractorRegistry.register(HtmlExtractor)
