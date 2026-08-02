// packages/lib/src/resources/picker/record-picker-cache.ts

import { BaseCacheService } from '../../cache/base-cache-service'
import type { PaginatedResourcesResult, RecordPickerItem } from './types'

/**
 * Options that discriminate one cached page from another.
 *
 * 🔴 `scope` is the **viewer** dimension (plan v3/06 §5.5). Everything else here
 * describes the QUERY; this describes who is allowed to see its answer. Without
 * it the key is `(orgId, entityDefinitionId, cursor, search, filters)` —
 * org-wide — so the first caller's visible set is served to every other member
 * of the org, in both directions. That is a leak on the narrow-reads-wide side
 * and silent data loss on the other, and it survives for the full 30-minute TTL.
 * A cached page is the same disclosure as a fresh one, which is the argument
 * step 0.1 already makes for `thread`.
 *
 * It is deliberately a short digest of the SORTED allow-list
 * (`knowledgeBaseScopeFingerprint`) rather than the member's user id: per §8.0
 * nearly every member composes the same allow-list, so they keep sharing one
 * entry and the hit rate barely moves. A user-id dimension would fragment the
 * cache by headcount for no enforcement gain — the enforcement is the SQL
 * predicate; this only stops two DIFFERENT answers colliding on one key.
 */
interface ListCacheOptions {
  cursor?: string | null
  search?: string
  filters?: Record<string, any>
  /**
   * Viewer-scope discriminator. `undefined` for tables carrying no
   * viewer-dependent scope, which keeps their keys byte-identical to the ones
   * they had before this parameter existed.
   */
  scope?: string
}

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
    options: ListCacheOptions
  ): string {
    const params = new URLSearchParams()
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.search) params.set('search', options.search)
    if (options.filters) params.set('filters', JSON.stringify(options.filters))
    if (options.scope) params.set('scope', options.scope)

    return this.buildKey('list', orgId, entityDefinitionId, params.toString())
  }

  /**
   * Cache paginated results
   */
  async cacheResources(
    orgId: string,
    entityDefinitionId: string,
    result: PaginatedResourcesResult,
    options: ListCacheOptions
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
    options: ListCacheOptions
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
