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
   * Invalidates all lists for the entity definition (they need new totals).
   */
  const onRecordCreated = useCallback((entityDefinitionId: string) => {
    getRecordStoreState().invalidateLists(entityDefinitionId)
  }, [])

  /**
   * Call after updating a record.
   * Record will be re-fetched on next access.
   */
  const onRecordUpdated = useCallback((entityDefinitionId: string, id: string) => {
    getRecordStoreState().invalidateRecord(entityDefinitionId, id)
  }, [])

  /**
   * Call after deleting a record.
   * Removes from cache and all lists.
   */
  const onRecordDeleted = useCallback((entityDefinitionId: string, id: string) => {
    getRecordStoreState().removeRecord(entityDefinitionId, id)
  }, [])

  /**
   * Call after bulk updates.
   * Invalidates multiple records.
   */
  const onBulkUpdated = useCallback((entityDefinitionId: string, ids: string[]) => {
    const store = getRecordStoreState()
    for (const id of ids) {
      store.invalidateRecord(entityDefinitionId, id)
    }
  }, [])

  /**
   * Call after bulk deletions.
   */
  const onBulkDeleted = useCallback((entityDefinitionId: string, ids: string[]) => {
    const store = getRecordStoreState()
    for (const id of ids) {
      store.removeRecord(entityDefinitionId, id)
    }
  }, [])

  /**
   * Clear all data for an entity definition.
   * Use after major data changes.
   */
  const invalidateResourceType = useCallback((entityDefinitionId: string) => {
    getRecordStoreState().invalidateResourceType(entityDefinitionId)
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
