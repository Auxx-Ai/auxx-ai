// apps/web/src/components/resources/hooks/use-relationship-sync.ts

import { useCallback } from 'react'
import {
  useFieldValueStore,
  buildFieldValueKey,
  parseFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { parseRecordId, toRecordId, type RecordId } from '@auxx/lib/resources/client'
import { isSingleRelationship, type RelationshipType } from '@auxx/utils'
import type { RelationshipFieldValue } from '@auxx/types/field-value'
import {
  parseResourceFieldId,
  fieldRefToKey,
  getFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'

/**
 * Info needed to sync inverse relationships.
 * Uses ResourceFieldId for type-safe field identification.
 */
export interface InverseSyncInfo {
  /** ResourceFieldId of the inverse field (e.g., "vendor:products") */
  inverseResourceFieldId: ResourceFieldId
  /** ResourceFieldId of the source field (e.g., "product:vendor") */
  sourceResourceFieldId: ResourceFieldId
  /** Relationship type of the INVERSE field (derived from source's relationshipType) */
  inverseRelationshipType: RelationshipType
  /** The entityDefinitionId of the TARGET entity */
  targetEntityDefinitionId: string
}

/** Input for computing inverse updates */
export interface SyncInput {
  /** The resource being updated (source) */
  sourceRecordId: RecordId
  /** Previous related record IDs */
  oldRelatedRecordIds: RecordId[]
  /** New related record IDs */
  newRelatedRecordIds: RecordId[]
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
  const setValueOptimistic = useFieldValueStore((s) => s.setValueOptimistic)

  /**
   * Sync inverse relationships in the cache.
   * Mirrors backend logic but operates on Zustand store.
   */
  const syncInverseCache = useCallback(
    (input: SyncInput) => {
      const { sourceRecordId, oldRelatedRecordIds, newRelatedRecordIds, inverseInfo } = input
      const { inverseResourceFieldId, sourceResourceFieldId, inverseRelationshipType } = inverseInfo

      // Parse source ResourceFieldId for entity definition ID
      const { entityDefinitionId: sourceEntityDefinitionId } =
        parseResourceFieldId(sourceResourceFieldId)

      // Get the plain FieldId for the inverse field (used in buildFieldValueKey)
      const inverseFieldId = getFieldId(inverseResourceFieldId)

      // Parse source for logging
      const { entityInstanceId: sourceInstanceId } = parseRecordId(sourceRecordId)

      // Calculate changes
      const removedRecordIds = oldRelatedRecordIds.filter(
        (id) => !newRelatedRecordIds.includes(id)
      )
      const addedRecordIds = newRelatedRecordIds.filter(
        (id) => !oldRelatedRecordIds.includes(id)
      )

      if (removedRecordIds.length === 0 && addedRecordIds.length === 0) {
        console.log(LOG_PREFIX, 'No changes detected, skipping sync')
        return
      }

      const isSingleValue = isSingleRelationship(inverseRelationshipType)

      // Get current state (need to access store directly for current values)
      const currentValues = useFieldValueStore.getState().values

      // ═══ Remove source from entities that were unlinked ═══
      for (const targetRecordId of removedRecordIds) {
        const key = buildFieldValueKey(targetRecordId, inverseFieldId)
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
          // Multi-value: filter out the sourceRecordId
          const currentArray = normalizeToArray(currentValue)
          const newArray = currentArray.filter((v) => {
            const relatedRecordId = extractRelatedRecordId(v)
            return relatedRecordId !== sourceRecordId
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
      if (isSingleValue && addedRecordIds.length > 0) {
        // Use fieldRefToKey for string comparison with parsed fieldRef
        const sourceRefKey = fieldRefToKey(sourceResourceFieldId)

        // Find all cached keys for this field type (e.g., all Vendor.products caches)
        for (const [cacheKey, cacheValue] of Object.entries(currentValues)) {
          const parsed = parseFieldValueKey(cacheKey as FieldValueKey)

          // Skip if not matching the source field
          if (fieldRefToKey(parsed.fieldRef) !== sourceRefKey) continue

          // Skip self
          if (parsed.entityInstanceId === sourceInstanceId) continue

          const ownerArray = normalizeToArray(cacheValue)
          const targetRecordIdsInOwner = ownerArray
            .map((v) => extractRelatedRecordId(v))
            .filter((id): id is RecordId => id !== null)

          // Check if any of our added targets are in this owner's collection
          const targetsToRemove = addedRecordIds.filter((id) =>
            targetRecordIdsInOwner.includes(id)
          )

          if (targetsToRemove.length > 0) {
            const filteredArray = ownerArray.filter((v) => {
              const relatedRecordId = extractRelatedRecordId(v)
              return !relatedRecordId || !targetsToRemove.includes(relatedRecordId)
            })
            setValueOptimistic(cacheKey as FieldValueKey, filteredArray)
          }
        }
      }

      // ═══ Add source to entities that were linked ═══
      for (const targetRecordId of addedRecordIds) {
        const key = buildFieldValueKey(targetRecordId, inverseFieldId)
        const currentValue = currentValues[key]
        const hasCache = key in currentValues

        if (!hasCache) {
          console.log(LOG_PREFIX, 'Skipping add - target not in cache')
          continue
        }

        // Parse target to get instanceId for RelationshipFieldValue
        const { entityInstanceId: targetInstanceId } = parseRecordId(targetRecordId)

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
            (v) => extractRelatedRecordId(v) === sourceRecordId
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
 * Extract the related RecordId from a relationship value.
 * Constructs RecordId from relatedEntityDefinitionId + relatedEntityId in the value.
 */
function extractRelatedRecordId(value: unknown): RecordId | null {
  if (!value || typeof value !== 'object') return null
  const rel = value as RelationshipFieldValue
  if (!rel.relatedEntityId || !rel.relatedEntityDefinitionId) return null
  return toRecordId(rel.relatedEntityDefinitionId, rel.relatedEntityId)
}

/**
 * Extract related RecordIds from a stored value (single or array).
 */
export function extractRelatedRecordIds(value: StoredFieldValue): RecordId[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value
      .map((v) => extractRelatedRecordId(v))
      .filter((id): id is RecordId => id !== null)
  }

  const id = extractRelatedRecordId(value)
  return id ? [id] : []
}
