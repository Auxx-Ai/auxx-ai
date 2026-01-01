// apps/web/src/components/resources/hooks/use-record-invalidation.ts

import { useCallback } from 'react'
import { getRecordStoreState } from '../store/record-store'

/**
 * Hook providing record store invalidation methods.
 * Use in mutation success handlers to keep cache in sync.
 */
export function useRecordInvalidation() {
  /**
   * Call after creating a new record.
   * Invalidates all lists for the resource type (they need new totals).
   */
  const onRecordCreated = useCallback((resourceType: string) => {
    getRecordStoreState().invalidateLists(resourceType)
  }, [])

  /**
   * Call after updating a record.
   * Record will be re-fetched on next access.
   */
  const onRecordUpdated = useCallback((resourceType: string, id: string) => {
    getRecordStoreState().invalidateRecord(resourceType, id)
  }, [])

  /**
   * Call after deleting a record.
   * Removes from cache and all lists.
   */
  const onRecordDeleted = useCallback((resourceType: string, id: string) => {
    getRecordStoreState().removeRecord(resourceType, id)
  }, [])

  /**
   * Call after bulk updates.
   * Invalidates multiple records.
   */
  const onBulkUpdated = useCallback((resourceType: string, ids: string[]) => {
    const store = getRecordStoreState()
    for (const id of ids) {
      store.invalidateRecord(resourceType, id)
    }
  }, [])

  /**
   * Call after bulk deletions.
   */
  const onBulkDeleted = useCallback((resourceType: string, ids: string[]) => {
    const store = getRecordStoreState()
    for (const id of ids) {
      store.removeRecord(resourceType, id)
    }
  }, [])

  /**
   * Clear all data for a resource type.
   * Use after major data changes.
   */
  const invalidateResourceType = useCallback((resourceType: string) => {
    getRecordStoreState().invalidateResourceType(resourceType)
  }, [])

  return {
    onRecordCreated,
    onRecordUpdated,
    onRecordDeleted,
    onBulkUpdated,
    onBulkDeleted,
    invalidateResourceType,
  }
}
