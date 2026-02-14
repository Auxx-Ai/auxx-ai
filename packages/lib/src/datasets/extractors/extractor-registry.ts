// packages/lib/src/datasets/extractors/extractor-registry.ts

import { createScopedLogger } from '@auxx/logger'
import type { ExtractorInfo } from '../types/extractor.types'
import type { BaseExtractor } from './base-extractor'

const logger = createScopedLogger('extractor-registry')

export class ExtractorRegistry {
  private static extractors = new Map<string, typeof BaseExtractor>()
  private static initialized = false

  /**
   * Register an extractor
   */
  static register(extractorClass: typeof BaseExtractor): void {
    // Create a temporary instance to get metadata
    const tempInstance = new (extractorClass as any)('temp', undefined, undefined)
    const name = tempInstance.getName()
    const capabilities = tempInstance.getSupportedTypes()

    ExtractorRegistry.extractors.set(name, extractorClass)
  }

  /**
   * Get all registered extractors
   */
  static getAll(): Map<string, typeof BaseExtractor> {
    ExtractorRegistry.ensureInitialized()
    return new Map(ExtractorRegistry.extractors)
  }

  /**
   * Get extractors compatible with a file type
   */
  static getCompatibleExtractors(mimeType: string, extension: string): ExtractorInfo[] {
    ExtractorRegistry.ensureInitialized()

    const compatible: ExtractorInfo[] = []

    for (const [name, ExtractorClass] of ExtractorRegistry.extractors.entries()) {
      try {
        // Create temporary instance to check compatibility
        const tempInstance = new (ExtractorClass as any)('temp', undefined, undefined)

        if (tempInstance.supports(mimeType, extension)) {
          const capabilities = tempInstance.getSupportedTypes()
          const priority = tempInstance.getPriority(mimeType, extension)

          compatible.push({
            name,
            priority,
            capabilities,
            isAvailable: ExtractorRegistry.isExtractorAvailable(name),
          })
        }
      } catch (error) {
        logger.warn('Failed to check extractor compatibility', {
          extractor: name,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Sort by priority (highest first) and availability
    return compatible.sort((a, b) => {
      // Available extractors come first
      if (a.isAvailable !== b.isAvailable) {
        return a.isAvailable ? -1 : 1
      }
      // Then by priority
      return b.priority - a.priority
    })
  }

  /**
   * Get the best extractor for a file type
   */
  static getBestExtractor(mimeType: string, extension: string): typeof BaseExtractor | null {
    const compatible = ExtractorRegistry.getCompatibleExtractors(mimeType, extension)

    if (compatible.length === 0) {
      logger.warn('No compatible extractors found', { mimeType, extension })
      return null
    }

    const best = compatible[0]
    if (!best!.isAvailable) {
      return null
    }

    return ExtractorRegistry.extractors.get(best!.name) || null
  }

  /**
   * Get extractor by name
   */
  static getExtractor(name: string): typeof BaseExtractor | null {
    ExtractorRegistry.ensureInitialized()
    return ExtractorRegistry.extractors.get(name) || null
  }

  /**
   * Check if an extractor is available (dependencies installed, etc.)
   */
  static isExtractorAvailable(name: string): boolean {
    const ExtractorClass = ExtractorRegistry.extractors.get(name)
    if (!ExtractorClass) return false

    try {
      // Try to create an instance to check if dependencies are available
      const tempInstance = new (ExtractorClass as any)('temp', undefined, undefined)
      return true
    } catch (error) {
      logger.debug('Extractor not available', {
        extractor: name,
        error: error instanceof Error ? error.message : error,
      })
      return false
    }
  }

  /**
   * Get registry statistics
   */
  static getStats(): {
    totalExtractors: number
    availableExtractors: number
    supportedMimeTypes: string[]
    supportedExtensions: string[]
  } {
    ExtractorRegistry.ensureInitialized()

    const allMimeTypes = new Set<string>()
    const allExtensions = new Set<string>()
    let availableCount = 0

    for (const [name, ExtractorClass] of ExtractorRegistry.extractors.entries()) {
      try {
        const tempInstance = new (ExtractorClass as any)('temp', undefined, undefined)
        const capabilities = tempInstance.getSupportedTypes()

        capabilities.mimeTypes.forEach((type: string) => allMimeTypes.add(type))
        capabilities.extensions.forEach((ext: string) => allExtensions.add(ext))

        if (ExtractorRegistry.isExtractorAvailable(name)) {
          availableCount++
        }
      } catch (error) {
        // Skip extractors that can't be instantiated
      }
    }

    return {
      totalExtractors: ExtractorRegistry.extractors.size,
      availableExtractors: availableCount,
      supportedMimeTypes: Array.from(allMimeTypes).sort(),
      supportedExtensions: Array.from(allExtensions).sort(),
    }
  }

  /**
   * Initialize registry with all available extractors
   */
  private static ensureInitialized(): void {
    if (ExtractorRegistry.initialized) return

    try {
      // Auto-register all available extractors
      ExtractorRegistry.autoRegisterExtractors()
      ExtractorRegistry.initialized = true

      const stats = ExtractorRegistry.getStats()
      logger.info('Extractor registry initialized', {
        totalExtractors: stats.totalExtractors,
        availableExtractors: stats.availableExtractors,
        mimeTypesCount: stats.supportedMimeTypes.length,
        extensionsCount: stats.supportedExtensions.length,
      })
    } catch (error) {
      logger.error('Failed to initialize extractor registry', {
        error: error instanceof Error ? error.message : error,
      })
      ExtractorRegistry.initialized = true // Prevent infinite retry
    }
  }

  /**
   * Auto-register all available extractors
   */
  private static autoRegisterExtractors(): void {
    // This will be populated as we create extractors
    // For now, just log that auto-registration is ready
    logger.debug('Auto-registration system ready')

    // Extractors will register themselves when imported
    // This allows for dynamic loading and lazy registration
  }

  /**
   * Clear registry (useful for testing)
   */
  static clear(): void {
    ExtractorRegistry.extractors.clear()
    ExtractorRegistry.initialized = false
    logger.debug('Extractor registry cleared')
  }

  /**
   * List all registered extractor names
   */
  static listExtractors(): string[] {
    ExtractorRegistry.ensureInitialized()
    return Array.from(ExtractorRegistry.extractors.keys()).sort()
  }
}
