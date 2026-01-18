// apps/web/src/components/resources/hooks/use-custom-field-invalidation.ts

import { useCallback } from 'react'
import {
  useFieldValueStore,
  toRecordId,
  type RecordId,
} from '~/components/resources/store/field-value-store'

/**
 * Hook providing invalidation methods for custom field values.
 * Use this after mutations to keep the store in sync.
 */
export function useCustomFieldInvalidation() {
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const invalidateResources = useFieldValueStore((s) => s.invalidateResources)
  const invalidateField = useFieldValueStore((s) => s.invalidateField)
  const invalidateByDefinition = useFieldValueStore((s) => s.invalidateByDefinition)

  /**
   * Invalidate after updating a single entity's field values.
   * Call this in your setValue mutation's success handler.
   */
  const onValueUpdated = useCallback(
    (entityDefinitionId: string, entityInstanceId: string) => {
      const recordId = toRecordId(entityDefinitionId, entityInstanceId)
      invalidateResource(recordId)
    },
    [invalidateResource]
  )

  /**
   * Invalidate after bulk updating multiple entities.
   * Call this after bulk operations complete.
   */
  const onBulkValuesUpdated = useCallback(
    (entityDefinitionId: string, entityInstanceIds: string[]) => {
      const recordIds = entityInstanceIds.map((id) => toRecordId(entityDefinitionId, id))
      invalidateResources(recordIds)
    },
    [invalidateResources]
  )

  /**
   * Invalidate after a field definition changes (name, options, etc.).
   * This clears all cached values for that field across all resources.
   */
  const onFieldDefinitionChanged = useCallback(
    (fieldId: string) => {
      invalidateField(fieldId)
    },
    [invalidateField]
  )

  /**
   * Invalidate all values for an entity definition.
   * Use sparingly - e.g., after major data imports.
   */
  const onEntityDefinitionInvalidated = useCallback(
    (entityDefinitionId: string) => {
      invalidateByDefinition(entityDefinitionId)
    },
    [invalidateByDefinition]
  )

  return {
    onValueUpdated,
    onBulkValuesUpdated,
    onFieldDefinitionChanged,
    onEntityDefinitionInvalidated,
  }
}
