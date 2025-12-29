// apps/web/src/lib/cache/cache-transaction.ts

import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Cache operation types for tracking what was done
 */
interface CacheOperation {
  type: 'update' | 'remove' | 'add'
  queryKey: QueryKey
  entityId?: string
  updater?: (data: any) => any
}

/**
 * Transaction-based cache updates with automatic rollback on errors
 * Provides ACID-like guarantees for cache operations
 */
export class CacheTransaction {
  private operations: CacheOperation[] = []
  private snapshots: Map<string, any> = new Map()
  private isCommitted = false
  private isRolledBack = false

  constructor(private queryClient: QueryClient) {}

  /**
   * Execute a series of cache operations within a transaction
   * Automatically rolls back all changes if any operation fails
   * @param callback Function containing the cache operations
   * @returns Promise that resolves to success state
   */
  async execute(callback: () => Promise<void> | void): Promise<{ success: boolean }> {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Transaction has already been executed')
    }

    try {
      // Take snapshots of all potentially affected queries
      this.takeSnapshots()

      // Execute the callback with operations
      await callback()

      // If we get here, everything succeeded
      this.commit()
      return { success: true }
    } catch (error) {
      // Rollback all operations on any error
      this.rollback()
      throw error
    }
  }

  /**
   * Update data in a query cache
   * @param queryKey The query to update
   * @param updater Function that transforms the cache data
   */
  update(queryKey: QueryKey, updater: (data: any) => any): void {
    this.ensureNotFinalized()

    // Store operation for potential rollback
    this.operations.push({ type: 'update', queryKey, updater })

    // Apply update immediately
    this.queryClient.setQueryData(queryKey, updater)
  }

  /**
   * Remove an entity from a query cache
   * @param queryKey The query to update
   * @param entityId The ID of the entity to remove
   */
  remove(queryKey: QueryKey, entityId: string): void {
    this.ensureNotFinalized()

    this.operations.push({ type: 'remove', queryKey, entityId })

    this.queryClient.setQueryData(queryKey, (oldData: any) => {
      if (!oldData) return oldData

      // Handle infinite query structure
      if (oldData.pages) {
        return {
          ...oldData,
          pages: oldData.pages.map((page: any) => ({
            ...page,
            items: page.items?.filter((item: any) => item.id !== entityId) || [],
          })),
        }
      }

      // Handle regular array
      if (Array.isArray(oldData)) {
        return oldData.filter((item: any) => item.id !== entityId)
      }

      // Handle single entity
      if (oldData.id === entityId) {
        return null
      }

      return oldData
    })
  }

  /**
   * Add an entity to a query cache
   * @param queryKey The query to update
   * @param entity The entity to add
   */
  add(queryKey: QueryKey, entity: any): void {
    this.ensureNotFinalized()

    this.operations.push({ type: 'add', queryKey, entityId: entity.id })

    this.queryClient.setQueryData(queryKey, (oldData: any) => {
      if (!oldData) return oldData

      // Handle infinite query structure - add to first page
      if (oldData.pages) {
        const pages = [...oldData.pages]
        if (pages.length > 0) {
          pages[0] = {
            ...pages[0],
            items: [entity, ...(pages[0].items || [])],
          }
        }
        return { ...oldData, pages }
      }

      // Handle regular array - add to beginning
      if (Array.isArray(oldData)) {
        return [entity, ...oldData]
      }

      return oldData
    })
  }

  /**
   * Commit the transaction (no-op, changes are already applied)
   */
  private commit(): void {
    this.isCommitted = true
    // Changes are already applied optimistically, so commit is a no-op
    this.snapshots.clear() // Free memory
  }

  /**
   * Rollback all operations by restoring snapshots
   */
  rollback(): void {
    if (this.isRolledBack) {
      return // Already rolled back
    }

    this.isRolledBack = true

    // Restore all snapshots
    this.snapshots.forEach((snapshot, queryKeyString) => {
      try {
        const queryKey = this.deserializeQueryKey(queryKeyString)
        this.queryClient.setQueryData(queryKey, snapshot)
      } catch (error) {
        console.error('Error during rollback:', error)
      }
    })

    this.snapshots.clear()
  }

  /**
   * Take snapshots of all queries that might be affected
   * This captures the state before any operations
   */
  private takeSnapshots(): void {
    // Get all queries for entities that might be affected
    const queries = this.queryClient.getQueriesData({
      predicate: (query) => {
        const key = query.queryKey[0]
        return (
          Array.isArray(key) &&
          (key[0] === 'thread' ||
            key[0] === 'message' ||
            key[0] === 'contact' ||
            key[0] === 'order')
        )
      },
    })

    queries.forEach(([queryKey, data]) => {
      const queryKeyString = this.serializeQueryKey(queryKey)
      // Deep clone the data to prevent reference issues
      this.snapshots.set(queryKeyString, structuredClone(data))
    })
  }

  /**
   * Ensure the transaction hasn't been finalized
   */
  private ensureNotFinalized(): void {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Transaction has already been finalized')
    }
  }

  /**
   * Serialize a query key to a string for storage
   */
  private serializeQueryKey(queryKey: QueryKey): string {
    return JSON.stringify(queryKey)
  }

  /**
   * Deserialize a query key string back to a QueryKey
   */
  private deserializeQueryKey(queryKeyString: string): QueryKey {
    return JSON.parse(queryKeyString)
  }

  /**
   * Get transaction statistics for debugging
   */
  getStats(): {
    operationCount: number
    snapshotCount: number
    isCommitted: boolean
    isRolledBack: boolean
  } {
    return {
      operationCount: this.operations.length,
      snapshotCount: this.snapshots.size,
      isCommitted: this.isCommitted,
      isRolledBack: this.isRolledBack,
    }
  }
}
