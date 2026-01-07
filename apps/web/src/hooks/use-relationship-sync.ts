// apps/web/src/hooks/use-relationship-sync.ts

import { useCallback } from 'react'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type StoredFieldValue,
} from '~/stores/custom-field-value-store'
import { isSingleValueRelationship, type RelationshipType } from '@auxx/utils'
import type { RelationshipFieldValue } from '@auxx/types/field-value'

/** Info needed to sync inverse relationships (mirrors DB options.relationship structure) */
export interface InverseSyncInfo {
  /** The field on the target entity that points back to source */
  inverseFieldId: string
  /** Relationship type of the INVERSE field (derived from source's relationshipType) */
  inverseRelationshipType: RelationshipType
  /** The entity definition ID of the SOURCE entity (for relatedEntityDefinitionId on inverse) */
  sourceEntityDefinitionId: string
  /** Target entity definition ID (from relatedEntityDefinitionId) or system model type */
  targetEntityDefId: string
  /** The field ID on the SOURCE entity (for cascade cleanup) */
  sourceFieldId: string
}

/** Input for computing inverse updates */
export interface SyncInput {
  /** The entity being updated */
  sourceEntityId: string
  /** Previous related entity IDs */
  oldRelatedIds: string[]
  /** New related entity IDs */
  newRelatedIds: string[]
  /** Inverse relationship info */
  inverseInfo: InverseSyncInfo
}

/** Logging prefix for relationship sync debugging */
const LOG_PREFIX = '[RelSync]'

/**
 * Hook for synchronizing inverse relationship caches.
 * Call this when saving a relationship field to update both sides optimistically.
 */
export function useRelationshipSync() {
  const setValueOptimistic = useCustomFieldValueStore((s) => s.setValueOptimistic)

  /**
   * Sync inverse relationships in the cache.
   * Mirrors backend logic but operates on Zustand store.
   */
  const syncInverseCache = useCallback(
    (input: SyncInput) => {
      const { sourceEntityId, oldRelatedIds, newRelatedIds, inverseInfo } = input
      const {
        inverseFieldId,
        inverseRelationshipType,
        sourceEntityDefinitionId,
        targetEntityDefId,
      } = inverseInfo

      // Calculate changes
      const removedIds = oldRelatedIds.filter((id) => !newRelatedIds.includes(id))
      const addedIds = newRelatedIds.filter((id) => !oldRelatedIds.includes(id))

      if (removedIds.length === 0 && addedIds.length === 0) {
        console.log(LOG_PREFIX, 'No changes detected, skipping sync')
        return
      }

      console.log(LOG_PREFIX, 'Syncing inverse cache', {
        sourceEntityId,
        oldRelatedIds,
        newRelatedIds,
        removedIds,
        addedIds,
        inverseFieldId,
        inverseRelationshipType,
        targetEntityDefId,
      })

      const isSingleValue = isSingleValueRelationship(inverseRelationshipType)

      // Get current state (need to access store directly for current values)
      const currentValues = useCustomFieldValueStore.getState().values

      // ═══ Remove source from entities that were unlinked ═══
      for (const targetId of removedIds) {
        const key = buildValueKey('entity', targetId, inverseFieldId, targetEntityDefId)
        const currentValue = currentValues[key]
        const hasCache = key in currentValues

        console.log(LOG_PREFIX, 'Removing from inverse', {
          targetId,
          key,
          hasCache,
          isSingleValue,
          currentValue,
        })

        if (!hasCache) {
          console.log(LOG_PREFIX, 'Skipping remove - target not in cache')
          continue
        }

        if (isSingleValue) {
          // Single-value: set to null
          setValueOptimistic(key, null)
        } else {
          // Multi-value: filter out the sourceEntityId
          const currentArray = normalizeToArray(currentValue)
          const newArray = currentArray.filter(
            (v) => extractRelatedEntityId(v) !== sourceEntityId
          )
          console.log(LOG_PREFIX, 'Filtered array', { before: currentArray.length, after: newArray.length })
          setValueOptimistic(key, newArray)
        }
      }

      // ═══ CASCADE: For single-value inverse, scan all cached owners to remove targets ═══
      // When inverse is belongs_to/has_one, a target can only have ONE owner.
      // Scan all cached entities of the same type to find and remove targets from old owners.
      // This works even when the target entity itself isn't in cache.
      if (isSingleValue && addedIds.length > 0) {
        const { sourceFieldId } = inverseInfo
        const keyPrefix = `entity:${sourceEntityDefinitionId}:`
        const keySuffix = `:${sourceFieldId}`

        // Find all cached keys for this field type (e.g., all Vendor.products caches)
        for (const [cacheKey, cacheValue] of Object.entries(currentValues)) {
          // Skip if not matching pattern: entity:{entityDefId}:{entityId}:{fieldId}
          if (!cacheKey.startsWith(keyPrefix) || !cacheKey.endsWith(keySuffix)) continue

          // Extract the owner ID from the cache key
          const ownerIdMatch = cacheKey.slice(keyPrefix.length, -keySuffix.length)
          if (!ownerIdMatch || ownerIdMatch === sourceEntityId) continue // Skip self

          const ownerArray = normalizeToArray(cacheValue)
          const targetIdsInOwner = ownerArray.map((v) => extractRelatedEntityId(v)).filter(Boolean)

          // Check if any of our added targets are in this owner's collection
          const targetsToRemove = addedIds.filter((id) => targetIdsInOwner.includes(id))

          if (targetsToRemove.length > 0) {
            const filteredArray = ownerArray.filter(
              (v) => !targetsToRemove.includes(extractRelatedEntityId(v) ?? '')
            )
            console.log(LOG_PREFIX, 'CASCADE: Removing targets from old owner', {
              oldOwnerId: ownerIdMatch,
              targetsToRemove,
              before: ownerArray.length,
              after: filteredArray.length,
            })
            setValueOptimistic(cacheKey, filteredArray)
          }
        }
      }

      // ═══ Add source to entities that were linked ═══
      for (const targetId of addedIds) {
        const key = buildValueKey('entity', targetId, inverseFieldId, targetEntityDefId)
        const currentValue = currentValues[key]
        const hasCache = key in currentValues

        console.log(LOG_PREFIX, 'Adding to inverse', {
          targetId,
          key,
          hasCache,
          isSingleValue,
          currentValue,
        })

        if (!hasCache) {
          console.log(LOG_PREFIX, 'Skipping add - target not in cache')
          continue
        }

        // Build the new relationship value pointing back to source
        const newRelValue: RelationshipFieldValue = {
          type: 'relationship',
          relatedEntityId: sourceEntityId,
          relatedEntityDefinitionId: sourceEntityDefinitionId,
          // Minimal fields for cache (full data comes from server)
          id: '',
          entityId: targetId,
          fieldId: inverseFieldId,
          sortKey: '',
          createdAt: '',
          updatedAt: '',
        }

        if (isSingleValue) {
          // Single-value: replace
          console.log(LOG_PREFIX, 'Setting single value', newRelValue)
          setValueOptimistic(key, newRelValue)
        } else {
          // Multi-value: append
          const currentArray = normalizeToArray(currentValue)
          // Check for duplicates
          const alreadyExists = currentArray.some(
            (v) => extractRelatedEntityId(v) === sourceEntityId
          )
          if (!alreadyExists) {
            console.log(LOG_PREFIX, 'Appending to array', { before: currentArray.length, after: currentArray.length + 1 })
            setValueOptimistic(key, [...currentArray, newRelValue])
          } else {
            console.log(LOG_PREFIX, 'Skipping add - already exists in array')
          }
        }
      }
    },
    [setValueOptimistic]
  )

  return { syncInverseCache }
}

// ═══ Helpers ═══

/**
 * Normalize a stored value to an array of relationship values
 */
function normalizeToArray(value: StoredFieldValue): RelationshipFieldValue[] {
  if (!value) return []
  if (Array.isArray(value)) return value as RelationshipFieldValue[]
  return [value as RelationshipFieldValue]
}

/**
 * Extract the relatedEntityId from a relationship value
 */
function extractRelatedEntityId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if ('relatedEntityId' in value) return (value as RelationshipFieldValue).relatedEntityId
  return null
}

/**
 * Extract related entity IDs from a stored value (single or array)
 */
export function extractRelatedIds(value: StoredFieldValue): string[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value
      .map((v) => extractRelatedEntityId(v))
      .filter((id): id is string => id !== null)
  }

  const id = extractRelatedEntityId(value)
  return id ? [id] : []
}
