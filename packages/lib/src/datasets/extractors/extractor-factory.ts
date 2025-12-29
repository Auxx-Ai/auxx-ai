// packages/lib/src/datasets/extractors/extractor-factory.ts

import { createScopedLogger } from '@auxx/logger'
import { ExtractorRegistry } from './extractor-registry'
import { BaseExtractor } from './base-extractor'
import type { ExtractionResult, ExtractionOptions, ExtractorInfo } from '../types/extractor.types'

// Auto-import all extractors to register them
import './text-extractor'
import './pdf-extractor'
import './docx-extractor'
import './html-extractor'

const logger = createScopedLogger('extractor-factory')

export interface ExtractorFactoryOptions extends ExtractionOptions {
  fallbackEnabled?: boolean
  maxRetries?: number
  cachingEnabled?: boolean
  preferredExtractor?: string
}

export interface ExtractorFactoryResult extends ExtractionResult {
  extractorUsed: string
  fallbacksAttempted: string[]
  cacheHit?: boolean
}

export class ExtractorFactory {
  /**
   * Extract content with automatic extractor selection and fallback
   */
  static async extractWithFallback(
    fileContent: Buffer,
    mimeType: string,
    extension: string,
    metadata: {
      fileName?: string,
      documentId?: string,
      organizationId?: string,
    },
    options: ExtractorFactoryOptions = {}
  ): Promise<ExtractorFactoryResult> {
    const startTime = Date.now()

    logger.info('Starting content extraction with fallback', {
      fileSize: fileContent.length,
      mimeType,
      extension,
      fileName: metadata.fileName,
      documentId: metadata.documentId,
      fallbackEnabled: options.fallbackEnabled !== false,
    })

    const fallbacksAttempted: string[] = []
    let lastError: Error | undefined

    try {
      // Get compatible extractors in priority order
      const compatibleExtractors = ExtractorRegistry.getCompatibleExtractors(mimeType, extension)

      if (compatibleExtractors.length === 0) {
        throw new Error(`No compatible extractors found for ${mimeType} (${extension})`)
      }

      logger.debug('Found compatible extractors', {
        count: compatibleExtractors.length,
        extractors: compatibleExtractors.map((e) => ({
          name: e.name,
          priority: e.priority,
          available: e.isAvailable,
        })),
      })

      // Try preferred extractor first if specified
      if (options.preferredExtractor) {
        const preferredResult = await this.trySpecificExtractor(
          options.preferredExtractor,
          fileContent,
          metadata,
          options
        )

        if (preferredResult) {
          logger.info('Extraction successful with preferred extractor', {
            extractor: options.preferredExtractor,
            processingTime: Date.now() - startTime,
          })

          return {
            ...preferredResult,
            extractorUsed: options.preferredExtractor,
            fallbacksAttempted,
          }
        } else {
          fallbacksAttempted.push(options.preferredExtractor)
        }
      }

      // Try extractors in priority order
      for (const extractorInfo of compatibleExtractors) {
        if (!extractorInfo.isAvailable) {
          logger.debug('Skipping unavailable extractor', { extractor: extractorInfo.name })
          continue
        }

        // Skip if already tried as preferred extractor
        if (options.preferredExtractor === extractorInfo.name) {
          continue
        }

        try {
          logger.debug('Attempting extraction', { extractor: extractorInfo.name })

          const result = await this.trySpecificExtractor(
            extractorInfo.name,
            fileContent,
            metadata,
            options
          )

          if (result) {
            const totalTime = Date.now() - startTime

            logger.info('Extraction successful', {
              extractor: extractorInfo.name,
              fallbacksUsed: fallbacksAttempted.length,
              totalTime,
            })

            return {
              ...result,
              extractorUsed: extractorInfo.name,
              fallbacksAttempted,
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown extraction error')
          fallbacksAttempted.push(extractorInfo.name)

          logger.warn('Extractor failed, trying next', {
            extractor: extractorInfo.name,
            error: lastError.message,
          })

          // If fallback is disabled, stop after first failure
          if (options.fallbackEnabled === false) {
            throw lastError
          }

          // Continue to next extractor
          continue
        }
      }

      // All extractors failed
      const totalTime = Date.now() - startTime

      logger.error('All extractors failed', {
        fileSize: fileContent.length,
        mimeType,
        extension,
        fileName: metadata.fileName,
        fallbacksAttempted,
        totalTime,
        lastError: lastError?.message,
      })

      throw new Error(
        `All extraction attempts failed. Tried: ${fallbacksAttempted.join(', ')}. ` +
          `Last error: ${lastError?.message || 'Unknown error'}`
      )
    } catch (error) {
      const totalTime = Date.now() - startTime

      logger.error('Extraction factory failed', {
        error: error instanceof Error ? error.message : error,
        fileSize: fileContent.length,
        fileName: metadata.fileName,
        totalTime,
        fallbacksAttempted,
      })

      throw error
    }
  }


  /**
   * Try a specific extractor
   */
  private static async trySpecificExtractor(
    extractorName: string,
    fileContent: Buffer,
    metadata: {
      fileName?: string,
      documentId?: string,
      organizationId?: string,
    },
    options: ExtractorFactoryOptions
  ): Promise<ExtractionResult | null> {
    const ExtractorClass = ExtractorRegistry.getExtractor(extractorName)

    if (!ExtractorClass) {
      logger.warn('Extractor not found', { extractor: extractorName })
      return null
    }

    if (!ExtractorRegistry.isExtractorAvailable(extractorName)) {
      logger.warn('Extractor not available', { extractor: extractorName })
      return null
    }

    try {
      // Create extractor instance
      const cacheKey = metadata.documentId ? `extract:${extractorName}:${metadata.documentId}` : undefined
      const extractor = new ExtractorClass(
        fileContent,
        metadata.fileName,
        cacheKey,
        options
      )

      // Extract content with retries
      const maxRetries = options.maxRetries || 2
      let lastError: Error | undefined

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.debug('Extraction attempt', {
            extractor: extractorName,
            attempt,
            maxRetries,
          })

          const result = await extractor.extract()

          logger.debug('Extraction successful', {
            extractor: extractorName,
            attempt,
            contentLength: result.content.length,
            wordCount: result.wordCount,
          })

          return result
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error')

          if (attempt === maxRetries) {
            logger.error('Extraction failed after all retries', {
              extractor: extractorName,
              attempts: maxRetries,
              error: lastError.message,
            })
            throw lastError
          }

          logger.warn('Extraction attempt failed, retrying', {
            extractor: extractorName,
            attempt,
            error: lastError.message,
          })

          // Brief delay before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }

      return null
    } catch (error) {
      logger.error('Extractor execution failed', {
        extractor: extractorName,
        error: error instanceof Error ? error.message : error,
      })

      throw error
    }
  }


  /**
   * Get extraction capabilities summary
   */
  static getCapabilities(): {
    extractors: ExtractorInfo[]
    totalMimeTypes: number
    totalExtensions: number
    availableExtractors: number
  } {
    const extractors = ExtractorRegistry.getCompatibleExtractors('*', '*')
    const stats = ExtractorRegistry.getStats()

    return {
      extractors,
      totalMimeTypes: stats.supportedMimeTypes.length,
      totalExtensions: stats.supportedExtensions.length,
      availableExtractors: stats.availableExtractors,
    }
  }
}

// Export the registry for direct access if needed
export { ExtractorRegistry }
