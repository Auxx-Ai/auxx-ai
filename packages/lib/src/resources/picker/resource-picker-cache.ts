// packages/lib/src/workflow-engine/resources/picker/resource-picker-cache.ts

import { BaseCacheService } from '@auxx/lib/cache'
import type { ResourcePickerItem, PaginatedResourcesResult } from './types'

/**
 * Cache service for resource picker data
 */
export class ResourcePickerCacheService extends BaseCacheService {
  constructor() {
    super('resource-picker', 1800) // 30 min TTL
  }

  /**
   * Build cache key for resource list queries
   */
  private buildListKey(
    orgId: string,
    tableId: string,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    },
  ): string {
    const params = new URLSearchParams()
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.search) params.set('search', options.search)
    if (options.filters) params.set('filters', JSON.stringify(options.filters))

    return this.buildKey('list', orgId, tableId, params.toString())
  }

  /**
   * Cache paginated results
   */
  async cacheResources(
    orgId: string,
    tableId: string,
    result: PaginatedResourcesResult,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    },
  ): Promise<void> {
    const key = this.buildListKey(orgId, tableId, options)
    await this.set(key, result, {
      ttl: 1800, // 30 minutes
      tags: ['resource-picker', `table:${tableId}`, `org:${orgId}`],
    })
  }

  /**
   * Get cached resources
   */
  async getCachedResources(
    orgId: string,
    tableId: string,
    options: {
      cursor?: string | null
      search?: string
      filters?: Record<string, any>
    },
  ): Promise<PaginatedResourcesResult | null> {
    const key = this.buildListKey(orgId, tableId, options)
    return this.get<PaginatedResourcesResult>(key)
  }

  /**
   * Cache single resource
   */
  async cacheSingleResource(
    orgId: string,
    tableId: string,
    item: ResourcePickerItem,
  ): Promise<void> {
    const key = this.buildKey('item', orgId, tableId, item.id)
    await this.set(key, item, {
      ttl: 3600, // 1 hour
      tags: ['resource-picker', `table:${tableId}`, `org:${orgId}`, `id:${item.id}`],
    })
  }

  /**
   * Get cached single resource
   */
  async getCachedSingleResource(
    orgId: string,
    tableId: string,
    id: string,
  ): Promise<ResourcePickerItem | null> {
    const key = this.buildKey('item', orgId, tableId, id)
    return this.get<ResourcePickerItem>(key)
  }

  /**
   * Invalidate by table
   */
  async invalidateByTable(tableId: string): Promise<void> {
    await this.invalidateByTag(`table:${tableId}`)
  }

  /**
   * Invalidate by ID
   */
  async invalidateById(tableId: string, id: string): Promise<void> {
    await this.invalidateByTag(`id:${id}`)
    await this.invalidateByTag(`table:${tableId}`)
  }
}
