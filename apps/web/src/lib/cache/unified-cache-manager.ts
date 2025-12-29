// apps/web/src/lib/cache/unified-cache-manager.ts

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { QueryDependencyTracker } from './query-dependency-tracker'
import { BatchedCacheUpdater } from './batched-cache-updater'

/**
 * Generic cache update options
 */
export interface CacheUpdateOptions {
  skipQueries?: QueryKey[]
  onlyQueries?: QueryKey[]
}

/**
 * Query filter for matching cache queries
 */
export interface QueryFilter {
  entityType?: string
  contextType?: string
  contextId?: string
  statusSlug?: string | string[]
  searchQuery?: string
  queries?: QueryKey[]
}

/**
 * Unified cache manager for all entity types (threads, messages, contacts, orders)
 * Provides intelligent cache updates with minimal re-renders and automatic dependency tracking
 */
export class UnifiedCacheManager<T extends { id: string }> {
  private tracker: QueryDependencyTracker
  private batchUpdater: BatchedCacheUpdater

  constructor(
    private queryClient: QueryClient,
    private entityType: 'thread' | 'message' | 'contact' | 'order'
  ) {
    this.tracker = new QueryDependencyTracker()
    this.batchUpdater = new BatchedCacheUpdater(queryClient)
  }

  /**
   * Update entity properties in all relevant caches with smart query tracking
   */
  updateEntityInAllQueries(
    entityId: string,
    updates: Partial<T>,
    options?: CacheUpdateOptions
  ): void {
    const affectedQueries = this.tracker.getAffectedQueries(entityId)

    affectedQueries.forEach((queryKey) => {
      if (options?.skipQueries?.some((skip) => this.queryKeysMatch(queryKey, skip))) {
        return
      }

      if (
        options?.onlyQueries &&
        !options.onlyQueries.some((only) => this.queryKeysMatch(queryKey, only))
      ) {
        return
      }

      this.batchUpdater.scheduleUpdate(queryKey, (data) => {
        return this.updateEntityInData(data, entityId, updates)
      })
    })
  }

  /**
   * Move entity between different query lists (e.g., archive/unarchive)
   */
  moveEntityBetweenQueries(
    entityId: string,
    updates: Partial<T>,
    fromFilter: QueryFilter,
    toFilter: QueryFilter
  ): void {
    const allQueries = this.getAllQueriesForEntityType()

    allQueries.forEach(([queryKey, data]) => {
      const queryFilter = this.parseQueryKey(queryKey)

      // Remove from source queries
      if (this.matchesFilter(queryFilter, fromFilter)) {
        this.batchUpdater.scheduleUpdate(queryKey, (data) => {
          return this.removeEntityFromData(data, entityId)
        })
      }
      // Add to destination queries
      else if (this.matchesFilter(queryFilter, toFilter)) {
        this.batchUpdater.scheduleUpdate(queryKey, (data) => {
          return this.addEntityToData(data, { id: entityId, ...updates } as T)
        })
      }
      // Update in place for other queries that contain this entity
      else if (this.dataContainsEntity(data, entityId)) {
        this.batchUpdater.scheduleUpdate(queryKey, (data) => {
          return this.updateEntityInData(data, entityId, updates)
        })
      }
    })
  }

  /**
   * Track that an entity appears in a specific query
   */
  trackEntityInQuery(entityId: string, queryKey: QueryKey): void {
    this.tracker.track(entityId, queryKey)
  }

  /**
   * Get all queries that contain this entity type
   */
  private getAllQueriesForEntityType(): Array<[QueryKey, any]> {
    return this.queryClient.getQueriesData({
      predicate: (query) => {
        const key = query.queryKey[0]
        return Array.isArray(key) && key.length >= 2 && key[0] === this.entityType
      },
    })
  }

  /**
   * Parse query key to extract filter information
   */
  private parseQueryKey(queryKey: QueryKey): QueryFilter {
    const key = queryKey[0] as any[]
    if (!Array.isArray(key) || key.length < 2) {
      return {}
    }

    // Extract input object from query key structure
    const input = key[2] // The input object from the query key
    return {
      entityType: key[0],
      contextType: input?.contextType,
      contextId: input?.contextId,
      statusSlug: input?.statusSlug,
      searchQuery: input?.searchQuery,
    }
  }

  /**
   * Check if a query filter matches a target filter
   */
  private matchesFilter(queryFilter: QueryFilter, targetFilter: QueryFilter): boolean {
    // Check entity type
    if (targetFilter.entityType && queryFilter.entityType !== targetFilter.entityType) {
      return false
    }

    // Check context type
    if (targetFilter.contextType && queryFilter.contextType !== targetFilter.contextType) {
      return false
    }

    // Check context ID
    if (targetFilter.contextId && queryFilter.contextId !== targetFilter.contextId) {
      return false
    }

    // Check status slug (can be string or array)
    if (targetFilter.statusSlug) {
      const targetSlugs = Array.isArray(targetFilter.statusSlug)
        ? targetFilter.statusSlug
        : [targetFilter.statusSlug]

      if (!targetSlugs.includes(queryFilter.statusSlug as string)) {
        return false
      }
    }

    // Check search query
    if (targetFilter.searchQuery && queryFilter.searchQuery !== targetFilter.searchQuery) {
      return false
    }

    return true
  }

  /**
   * Update entity in data structure (handles infinite queries and regular arrays)
   */
  private updateEntityInData(data: any, entityId: string, updates: Partial<T>): any {
    if (!data) return data

    // Handle infinite query structure
    if (data.pages) {
      return {
        ...data,
        pages: data.pages.map((page: any) => ({
          ...page,
          items: page.items?.map((item: any) =>
            item.id === entityId ? { ...item, ...updates } : item
          ),
        })),
      }
    }

    // Handle regular array
    if (Array.isArray(data)) {
      return data.map((item: any) => (item.id === entityId ? { ...item, ...updates } : item))
    }

    // Handle single entity
    if (data.id === entityId) {
      return { ...data, ...updates }
    }

    return data
  }

  /**
   * Remove entity from data structure
   */
  private removeEntityFromData(data: any, entityId: string): any {
    if (!data) return data

    // Handle infinite query structure
    if (data.pages) {
      return {
        ...data,
        pages: data.pages.map((page: any) => ({
          ...page,
          items: page.items?.filter((item: any) => item.id !== entityId) || [],
        })),
      }
    }

    // Handle regular array
    if (Array.isArray(data)) {
      return data.filter((item: any) => item.id !== entityId)
    }

    // Handle single entity (return null if it's the entity to remove)
    if (data.id === entityId) {
      return null
    }

    return data
  }

  /**
   * Add entity to data structure
   */
  private addEntityToData(data: any, entity: T): any {
    if (!data) return data

    // Handle infinite query structure - add to first page
    if (data.pages) {
      const pages = [...data.pages]
      if (pages.length > 0) {
        pages[0] = {
          ...pages[0],
          items: [entity, ...(pages[0].items || [])],
        }
      }
      return { ...data, pages }
    }

    // Handle regular array - add to beginning
    if (Array.isArray(data)) {
      return [entity, ...data]
    }

    return data
  }

  /**
   * Check if data contains a specific entity
   */
  private dataContainsEntity(data: any, entityId: string): boolean {
    if (!data) return false

    // Handle infinite query structure
    if (data.pages) {
      return data.pages.some((page: any) => page.items?.some((item: any) => item.id === entityId))
    }

    // Handle regular array
    if (Array.isArray(data)) {
      return data.some((item: any) => item.id === entityId)
    }

    // Handle single entity
    return data.id === entityId
  }

  /**
   * Check if two query keys match
   */
  private queryKeysMatch(key1: QueryKey, key2: QueryKey): boolean {
    return JSON.stringify(key1) === JSON.stringify(key2)
  }
}
