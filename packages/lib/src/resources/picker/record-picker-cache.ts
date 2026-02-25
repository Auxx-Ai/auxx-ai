// packages/lib/src/resources/picker/record-picker-cache.ts

import { BaseCacheService } from '../../cache/base-cache-service'
import type { PaginatedResourcesResult, RecordPickerItem } from './types'

/**
 * Cache service for record picker data
 */
export class RecordPickerCacheService extends BaseCacheService {
  constructor() {
    super('record-picker', 1800) // 30 min TTL
  }

  /**
   * Build cache key for record list queries
   */
  private buildListKey(
    orgId: string,
    entityDefinitionId: string,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    }
  ): string {
    const params = new URLSearchParams()
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.search) params.set('search', options.search)
    if (options.filters) params.set('filters', JSON.stringify(options.filters))

    return this.buildKey('list', orgId, entityDefinitionId, params.toString())
  }

  /**
   * Cache paginated results
   */
  async cacheResources(
    orgId: string,
    entityDefinitionId: string,
    result: PaginatedResourcesResult,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    }
  ): Promise<void> {
    const key = this.buildListKey(orgId, entityDefinitionId, options)
    await this.set(key, result, {
      ttl: 1800, // 30 minutes
      tags: ['record-picker', `entity:${entityDefinitionId}`, `org:${orgId}`],
    })
  }

  /**
   * Get cached resources
   */
  async getCachedResources(
    orgId: string,
    entityDefinitionId: string,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    }
  ): Promise<PaginatedResourcesResult | null> {
    const key = this.buildListKey(orgId, entityDefinitionId, options)
    return this.get<PaginatedResourcesResult>(key)
  }

  /**
   * Cache single record
   */
  async cacheSingleResource(
    orgId: string,
    entityDefinitionId: string,
    item: RecordPickerItem
  ): Promise<void> {
    const key = this.buildKey('item', orgId, entityDefinitionId, item.id)
    await this.set(key, item, {
      ttl: 3600, // 1 hour
      tags: ['record-picker', `entity:${entityDefinitionId}`, `org:${orgId}`, `id:${item.id}`],
    })
  }

  /**
   * Get cached single record
   */
  async getCachedSingleResource(
    orgId: string,
    entityDefinitionId: string,
    id: string
  ): Promise<RecordPickerItem | null> {
    const key = this.buildKey('item', orgId, entityDefinitionId, id)
    return this.get<RecordPickerItem>(key)
  }

  /**
   * Invalidate by entity definition
   */
  async invalidateByTable(entityDefinitionId: string): Promise<void> {
    await this.invalidateByTag(`entity:${entityDefinitionId}`)
  }

  /**
   * Invalidate by ID
   */
  async invalidateById(entityDefinitionId: string, id: string): Promise<void> {
    await this.invalidateByTag(`id:${id}`)
    await this.invalidateByTag(`entity:${entityDefinitionId}`)
  }
}
