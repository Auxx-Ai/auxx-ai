// packages/lib/src/datasets/vector/factory.ts

import type { VectorDbType } from '@auxx/database/types'
import { VectorDbType as VectorDbTypeEnum } from '@auxx/database/enums'
import type { VectorDatabase, VectorDatabaseConfig } from '../types/vector.types'
import { PostgreSQLVectorDB } from './postgresql'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('vector-db-factory')

/**
 * Factory for creating vector database instances
 *
 * Manages instance caching and provides a consistent interface
 * for creating different types of vector databases
 */
export class VectorDatabaseFactory {
  private static instances = new Map<string, VectorDatabase>()

  /**
   * Create or retrieve cached vector database instance
   */
  static async create(datasetId: string, config: VectorDatabaseConfig): Promise<VectorDatabase> {
    const cacheKey = `${datasetId}-${config.type}`

    // Return cached instance if available and healthy
    if (this.instances.has(cacheKey)) {
      const instance = this.instances.get(cacheKey)!
      try {
        const isHealthy = await instance.healthCheck()
        if (isHealthy) {
          return instance
        } else {
          // Remove unhealthy instance from cache
          this.instances.delete(cacheKey)
        }
      } catch (error) {
        logger.warn('Cached vector database instance unhealthy, recreating', {
          datasetId,
          type: config.type,
          error: error instanceof Error ? error.message : error,
        })
        this.instances.delete(cacheKey)
      }
    }

    const collectionName = this.generateCollectionName(datasetId)
    let instance: VectorDatabase

    try {
      switch (config.type) {
        case VectorDbTypeEnum.POSTGRESQL:
          instance = new PostgreSQLVectorDB(config, collectionName)
          break

        // Future implementations will be added here:
        // case VectorDbType.CHROMA:
        //   instance = new ChromaVectorDB(config, collectionName)
        //   break

        // case VectorDbType.QDRANT:
        //   instance = new QdrantVectorDB(config, collectionName)
        //   break

        default:
          throw new Error(`Unsupported vector database type: ${config.type}`)
      }

      // Verify the instance is functional
      await instance.healthCheck()

      // Cache the instance
      this.instances.set(cacheKey, instance)

      logger.info('Vector database instance created', {
        datasetId,
        type: config.type,
        collectionName,
      })

      return instance
    } catch (error) {
      logger.error('Failed to create vector database instance', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        type: config.type,
      })
      throw error
    }
  }

  /**
   * Generate consistent collection name from dataset ID
   *
   * Ensures collection names are valid across different vector databases
   */
  static generateCollectionName(datasetId: string): string {
    // Generate consistent, valid collection names across all databases
    // Remove hyphens and convert to underscore format
    return `dataset_${datasetId.replace(/-/g, '_')}`
  }

  /**
   * Clear cached instances
   */
  static clearCache(datasetId?: string) {
    if (datasetId) {
      // Remove specific dataset instances
      for (const [key] of this.instances) {
        if (key.startsWith(datasetId)) {
          this.instances.delete(key)
        }
      }
      logger.info('Vector database cache cleared for dataset', { datasetId })
    } else {
      // Clear all instances
      this.instances.clear()
      logger.info('Vector database cache cleared completely')
    }
  }

  /**
   * Get list of supported vector database types
   */
  static getSupportedDatabases(): VectorDbType[] {
    return [
      VectorDbTypeEnum.POSTGRESQL,
      // Future supported databases will be added here
    ]
  }

  /**
   * Check if a database type is supported
   */
  static isSupported(type: VectorDbType): boolean {
    return this.getSupportedDatabases().includes(type)
  }

  /**
   * Get cached instance count for monitoring
   */
  static getCacheStats() {
    const stats = {
      totalInstances: this.instances.size,
      instancesByType: {} as Record<string, number>,
    }

    for (const [key, instance] of this.instances) {
      const type = instance.getConfig().type
      stats.instancesByType[type] = (stats.instancesByType[type] || 0) + 1
    }

    return stats
  }

  /**
   * Perform health checks on all cached instances
   */
  static async healthCheckAll(): Promise<{
    healthy: number
    unhealthy: number
    details: Array<{ key: string; healthy: boolean; error?: string }>
  }> {
    const results = {
      healthy: 0,
      unhealthy: 0,
      details: [] as Array<{ key: string; healthy: boolean; error?: string }>,
    }

    const healthChecks = Array.from(this.instances.entries()).map(async ([key, instance]) => {
      try {
        const isHealthy = await instance.healthCheck()
        if (isHealthy) {
          results.healthy++
          results.details.push({ key, healthy: true })
        } else {
          results.unhealthy++
          results.details.push({ key, healthy: false })
        }
      } catch (error) {
        results.unhealthy++
        results.details.push({
          key,
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })

    await Promise.all(healthChecks)
    return results
  }
}
