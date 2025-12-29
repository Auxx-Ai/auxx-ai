// apps/web/src/lib/cache/query-dependency-tracker.ts

import type { QueryKey } from '@tanstack/react-query'

/**
 * Tracks which queries depend on which entities for intelligent cache updates
 * This allows us to only update queries that actually contain a specific entity
 */
export class QueryDependencyTracker {
  private dependencies = new Map<string, Set<string>>()

  /**
   * Track that an entity appears in a specific query
   * @param entityId The ID of the entity
   * @param queryKey The query key where this entity appears
   */
  track(entityId: string, queryKey: QueryKey): void {
    const queryKeyString = this.serializeQueryKey(queryKey)

    if (!this.dependencies.has(entityId)) {
      this.dependencies.set(entityId, new Set())
    }

    this.dependencies.get(entityId)!.add(queryKeyString)
  }

  /**
   * Stop tracking an entity in a specific query
   * @param entityId The ID of the entity
   * @param queryKey The query key to stop tracking
   */
  untrack(entityId: string, queryKey: QueryKey): void {
    const queryKeyString = this.serializeQueryKey(queryKey)
    const entityQueries = this.dependencies.get(entityId)

    if (entityQueries) {
      entityQueries.delete(queryKeyString)

      // Clean up empty sets
      if (entityQueries.size === 0) {
        this.dependencies.delete(entityId)
      }
    }
  }

  /**
   * Get all query keys that contain this entity
   * @param entityId The ID of the entity
   * @returns Array of query keys that contain this entity
   */
  getAffectedQueries(entityId: string): QueryKey[] {
    const entityQueries = this.dependencies.get(entityId)
    if (!entityQueries) {
      return []
    }

    return Array.from(entityQueries).map((queryKeyString) =>
      this.deserializeQueryKey(queryKeyString)
    )
  }

  /**
   * Get all entities that appear in a specific query
   * @param queryKey The query key
   * @returns Array of entity IDs that appear in this query
   */
  getEntitiesInQuery(queryKey: QueryKey): string[] {
    const queryKeyString = this.serializeQueryKey(queryKey)
    const entities: string[] = []

    this.dependencies.forEach((queries, entityId) => {
      if (queries.has(queryKeyString)) {
        entities.push(entityId)
      }
    })

    return entities
  }

  /**
   * Remove all tracking for a specific query
   * Useful when a query is no longer active
   * @param queryKey The query key to remove
   */
  removeQuery(queryKey: QueryKey): void {
    const queryKeyString = this.serializeQueryKey(queryKey)

    this.dependencies.forEach((queries, entityId) => {
      queries.delete(queryKeyString)

      // Clean up empty sets
      if (queries.size === 0) {
        this.dependencies.delete(entityId)
      }
    })
  }

  /**
   * Clear all tracking data
   * Useful for testing or when resetting the cache
   */
  clear(): void {
    this.dependencies.clear()
  }

  /**
   * Get statistics about the current tracking state
   * Useful for debugging and monitoring
   */
  getStats(): {
    totalEntities: number
    totalQueries: number
    averageQueriesPerEntity: number
  } {
    const totalEntities = this.dependencies.size
    let totalQueries = 0

    // Count unique queries
    const uniqueQueries = new Set<string>()
    this.dependencies.forEach((queries) => {
      queries.forEach((query) => uniqueQueries.add(query))
      totalQueries += queries.size
    })

    return {
      totalEntities,
      totalQueries: uniqueQueries.size,
      averageQueriesPerEntity: totalEntities > 0 ? totalQueries / totalEntities : 0,
    }
  }

  /**
   * Serialize a query key to a string for storage in Map/Set
   * @param queryKey The query key to serialize
   * @returns Serialized string representation
   */
  private serializeQueryKey(queryKey: QueryKey): string {
    return JSON.stringify(queryKey)
  }

  /**
   * Deserialize a query key string back to a QueryKey
   * @param queryKeyString The serialized query key
   * @returns The original QueryKey
   */
  private deserializeQueryKey(queryKeyString: string): QueryKey {
    return JSON.parse(queryKeyString)
  }
}
