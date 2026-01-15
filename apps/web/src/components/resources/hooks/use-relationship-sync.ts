// apps/web/src/hooks/use-relationship-sync.ts

import { useCallback } from 'react'
import {
  useCustomFieldValueStore,
  buildFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import { parseResourceId, toResourceId, type ResourceId } from '@auxx/lib/resources/client'
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
  /** The entityDefinitionId of the TARGET entity */
  targetEntityDefinitionId: string
  /** The field ID on the SOURCE entity (for cascade cleanup) */
  sourceFieldId: string
}

/** Input for computing inverse updates */
export interface SyncInput {
  /** The resource being updated (source) */
  sourceResourceId: ResourceId
  /** Previous related resource IDs */
  oldRelatedResourceIds: ResourceId[]
  /** New related resource IDs */
  newRelatedResourceIds: ResourceId[]
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
      const { sourceResourceId, oldRelatedResourceIds, newRelatedResourceIds, inverseInfo } = input
      const {
        inverseFieldId,
        inverseRelationshipType,
        sourceEntityDefinitionId,
        targetEntityDefinitionId,
      } = inverseInfo

      // Parse source for logging
      const { entityInstanceId: sourceInstanceId } = parseResourceId(sourceResourceId)

      // Calculate changes
      const removedResourceIds = oldRelatedResourceIds.filter(
        (id) => !newRelatedResourceIds.includes(id)
      )
      const addedResourceIds = newRelatedResourceIds.filter(
        (id) => !oldRelatedResourceIds.includes(id)
      )

      if (removedResourceIds.length === 0 && addedResourceIds.length === 0) {
        console.log(LOG_PREFIX, 'No changes detected, skipping sync')
        return
      }

      const isSingleValue = isSingleValueRelationship(inverseRelationshipType)

      // Get current state (need to access store directly for current values)
      const currentValues = useCustomFieldValueStore.getState().values

      // ═══ Remove source from entities that were unlinked ═══
      for (const targetResourceId of removedResourceIds) {
        const key = buildFieldValueKey(targetResourceId, inverseFieldId)
        const currentValue = currentValues[key]
        const hasCache = key in currentValues

        if (!hasCache) {
          console.log(LOG_PREFIX, 'Skipping remove - target not in cache')
          continue
        }

        if (isSingleValue) {
          // Single-value: set to null
          setValueOptimistic(key, null)
        } else {
          // Multi-value: filter out the sourceResourceId
          const currentArray = normalizeToArray(currentValue)
          const newArray = currentArray.filter((v) => {
            const relatedResourceId = extractRelatedResourceId(v)
            return relatedResourceId !== sourceResourceId
          })
          console.log(LOG_PREFIX, 'Filtered array', {
            before: currentArray.length,
            after: newArray.length,
          })
          setValueOptimistic(key, newArray)
        }
      }

      // ═══ CASCADE: For single-value inverse, scan all cached owners to remove targets ═══
      // When inverse is belongs_to/has_one, a target can only have ONE owner.
      // Scan all cached entities of the same type to find and remove targets from old owners.
      // This works even when the target entity itself isn't in cache.
      if (isSingleValue && addedResourceIds.length > 0) {
        const { sourceFieldId } = inverseInfo
        // Key format: ${entityDefinitionId}:${entityInstanceId}:${fieldId}
        const keyPrefix = `${sourceEntityDefinitionId}:`
        const keySuffix = `:${sourceFieldId}`

        // Find all cached keys for this field type (e.g., all Vendor.products caches)
        for (const [cacheKey, cacheValue] of Object.entries(currentValues)) {
          // Skip if not matching pattern: {entityDefId}:{entityId}:{fieldId}
          if (!cacheKey.startsWith(keyPrefix) || !cacheKey.endsWith(keySuffix)) continue

          // Extract the owner ID from the cache key
          const ownerInstanceId = cacheKey.slice(keyPrefix.length, -keySuffix.length)
          if (!ownerInstanceId || ownerInstanceId === sourceInstanceId) continue // Skip self

          const ownerArray = normalizeToArray(cacheValue)
          const targetResourceIdsInOwner = ownerArray
            .map((v) => extractRelatedResourceId(v))
            .filter((id): id is ResourceId => id !== null)

          // Check if any of our added targets are in this owner's collection
          const targetsToRemove = addedResourceIds.filter((id) =>
            targetResourceIdsInOwner.includes(id)
          )

          if (targetsToRemove.length > 0) {
            const filteredArray = ownerArray.filter((v) => {
              const relatedResourceId = extractRelatedResourceId(v)
              return !relatedResourceId || !targetsToRemove.includes(relatedResourceId)
            })
            setValueOptimistic(cacheKey as FieldValueKey, filteredArray)
          }
        }
      }

      // ═══ Add source to entities that were linked ═══
      for (const targetResourceId of addedResourceIds) {
        const key = buildFieldValueKey(targetResourceId, inverseFieldId)
        const currentValue = currentValues[key]
        const hasCache = key in currentValues

        if (!hasCache) {
          console.log(LOG_PREFIX, 'Skipping add - target not in cache')
          continue
        }

        // Parse target to get instanceId for RelationshipFieldValue
        const { entityInstanceId: targetInstanceId } = parseResourceId(targetResourceId)

        // Build the new relationship value pointing back to source
        const newRelValue: RelationshipFieldValue = {
          type: 'relationship',
          relatedEntityId: sourceInstanceId, // Still uses instanceId in the value object
          relatedEntityDefinitionId: sourceEntityDefinitionId,
          // Minimal fields for cache (full data comes from server)
          id: '',
          entityId: targetInstanceId,
          fieldId: inverseFieldId,
          sortKey: '',
          createdAt: '',
          updatedAt: '',
        }

        if (isSingleValue) {
          // Single-value: replace
          setValueOptimistic(key, newRelValue)
        } else {
          // Multi-value: append
          const currentArray = normalizeToArray(currentValue)
          // Check for duplicates
          const alreadyExists = currentArray.some(
            (v) => extractRelatedResourceId(v) === sourceResourceId
          )
          if (!alreadyExists) {
            console.log(LOG_PREFIX, 'Appending to array', {
              before: currentArray.length,
              after: currentArray.length + 1,
            })
            setValueOptimistic(key, [...currentArray, newRelValue])
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
 * Extract the related ResourceId from a relationship value.
 * Constructs ResourceId from relatedEntityDefinitionId + relatedEntityId in the value.
 */
function extractRelatedResourceId(value: unknown): ResourceId | null {
  if (!value || typeof value !== 'object') return null
  const rel = value as RelationshipFieldValue
  if (!rel.relatedEntityId || !rel.relatedEntityDefinitionId) return null
  return toResourceId(rel.relatedEntityDefinitionId, rel.relatedEntityId)
}

/**
 * Extract related ResourceIds from a stored value (single or array).
 */
export function extractRelatedResourceIds(value: StoredFieldValue): ResourceId[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value
      .map((v) => extractRelatedResourceId(v))
      .filter((id): id is ResourceId => id !== null)
  }

  const id = extractRelatedResourceId(value)
  return id ? [id] : []
}
