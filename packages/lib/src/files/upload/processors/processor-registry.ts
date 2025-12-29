// packages/lib/src/files/upload/processors/processor-registry.ts

import { createScopedLogger } from '@auxx/logger'
import type { BaseProcessor } from './base-processor'
import type { EntityType } from '../../types/entities'

const logger = createScopedLogger('processor-registry')

/**
 * Factory function type for creating processors
 */
export type ProcessorFactory = (organizationId: string) => BaseProcessor

/**
 * Registry for managing file upload processors
 * Simplified to register processors directly by EntityType
 */
export class ProcessorRegistry {
  private static entityProcessors = new Map<EntityType, ProcessorFactory>()
  private static defaultProcessorFactory: ProcessorFactory | null = null
  private static initialized = false

  /**
   * Register a processor factory for an entity type
   */
  static registerForEntity(entityType: EntityType, factory: ProcessorFactory): void {
    if (this.entityProcessors.has(entityType)) {
      logger.warn(`Processor for entity type ${entityType} already registered, overwriting`)
    }

    this.entityProcessors.set(entityType, factory)
    logger.info(`Registered processor for entity: ${entityType}`)
  }

  /**
   * Set the default processor factory for unknown entity types
   */
  static setDefaultProcessor(factory: ProcessorFactory): void {
    this.defaultProcessorFactory = factory
    logger.info('Set default processor factory')
  }

  /**
   * Mark processors as initialized (called by the initialization function)
   */
  static markInitialized(): void {
    this.initialized = true
  }

  /**
   * Check if processors are initialized
   */
  static isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get a processor instance for the given entity type and organization
   */
  static getForEntityType(entityType: EntityType, organizationId: string): BaseProcessor {
    // Check if processors are initialized, if not, warn but continue
    if (!this.initialized) {
      logger.warn(
        'Processors not initialized, this may cause issues. Call ensureProcessorsInitialized() first.'
      )
    }

    const factory = this.entityProcessors.get(entityType) || this.defaultProcessorFactory

    if (!factory) {
      throw new Error(`No processor found for entity type: ${entityType}`)
    }

    try {
      return factory(organizationId)
    } catch (error) {
      logger.error(`Failed to create processor for entity ${entityType}`, {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
      })
      throw error
    }
  }
  /**
   * Check if a processor is registered for the given entity type
   */
  static hasProcessor(entityType: EntityType): boolean {
    return this.entityProcessors.has(entityType)
  }

  /**
   * Unregister a processor
   */
  static unregisterProcessor(entityType: EntityType): boolean {
    const removed = this.entityProcessors.delete(entityType)
    if (removed) {
      logger.info(`Unregistered processor: ${entityType}`)
    }
    return removed
  }

  /**
   * Get all registered entity types
   */
  static getRegisteredTypes(): EntityType[] {
    return Array.from(this.entityProcessors.keys())
  }

  /**
   * Get the count of registered processors
   */
  static getProcessorCount(): number {
    return this.entityProcessors.size
  }

  /**
   * Clear all registered processors
   */
  static clear(): void {
    const count = this.entityProcessors.size
    this.entityProcessors.clear()
    logger.info(`Cleared ${count} registered processors`)
  }
}
