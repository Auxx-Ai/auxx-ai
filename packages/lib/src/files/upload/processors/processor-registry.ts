// packages/lib/src/files/upload/processors/processor-registry.ts

import { createScopedLogger } from '@auxx/logger'
import { BadRequestError } from '../../../errors'
import type { EntityType } from '../../types/entities'
import type { BaseProcessor } from './base-processor'

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
  private static initialized = false

  /**
   * Register a processor factory for an entity type
   */
  static registerForEntity(entityType: EntityType, factory: ProcessorFactory): void {
    if (ProcessorRegistry.entityProcessors.has(entityType)) {
      logger.warn(`Processor for entity type ${entityType} already registered, overwriting`)
    }

    ProcessorRegistry.entityProcessors.set(entityType, factory)
    logger.info(`Registered processor for entity: ${entityType}`)
  }

  /**
   * Mark processors as initialized (called by the initialization function)
   */
  static markInitialized(): void {
    ProcessorRegistry.initialized = true
  }

  /**
   * Check if processors are initialized
   */
  static isInitialized(): boolean {
    return ProcessorRegistry.initialized
  }

  /**
   * Get a processor instance for the given entity type and organization.
   *
   * There is deliberately **no default processor**: falling back to `FileProcessor` for an
   * unregistered entity type silently produced a `FolderFile` (and no `assetId`) for entity
   * types that need a `MediaAsset` + `Attachment` — see
   * `docs/files-upload-architecture-guide.md` §11.3. An unregistered type is a programming
   * error and must fail loudly at the front door.
   *
   * @throws {BadRequestError} when the registry is uninitialized or the entity type has no
   *   registered processor.
   */
  static getForEntityType(entityType: EntityType, organizationId: string): BaseProcessor {
    // A silently-uninitialized registry produces the wrong record type, so this is fatal
    // rather than a warning.
    if (!ProcessorRegistry.initialized) {
      throw new BadRequestError(
        'Upload processors are not initialized. Call ensureProcessorsInitialized() first.'
      )
    }

    const factory = ProcessorRegistry.entityProcessors.get(entityType)

    if (!factory) {
      throw new BadRequestError(`No upload processor registered for entity type: ${entityType}`)
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
    return ProcessorRegistry.entityProcessors.has(entityType)
  }

  /**
   * Unregister a processor
   */
  static unregisterProcessor(entityType: EntityType): boolean {
    const removed = ProcessorRegistry.entityProcessors.delete(entityType)
    if (removed) {
      logger.info(`Unregistered processor: ${entityType}`)
    }
    return removed
  }

  /**
   * Get all registered entity types
   */
  static getRegisteredTypes(): EntityType[] {
    return Array.from(ProcessorRegistry.entityProcessors.keys())
  }

  /**
   * Get the count of registered processors
   */
  static getProcessorCount(): number {
    return ProcessorRegistry.entityProcessors.size
  }

  /**
   * Clear all registered processors. A cleared registry is by definition no longer
   * initialized, so `getForEntityType` throws until it is populated again.
   */
  static clear(): void {
    const count = ProcessorRegistry.entityProcessors.size
    ProcessorRegistry.entityProcessors.clear()
    ProcessorRegistry.initialized = false
    logger.info(`Cleared ${count} registered processors`)
  }
}
