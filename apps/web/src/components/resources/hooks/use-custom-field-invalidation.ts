// apps/web/src/hooks/use-custom-field-invalidation.ts

import { useCallback } from 'react'
import {
  useCustomFieldValueStore,
  type ResourceType,
} from '~/components/resources/store/custom-field-value-store'

/**
 * Hook providing invalidation methods for custom field values.
 * Use this after mutations to keep the store in sync.
 */
export function useCustomFieldInvalidation() {
  const invalidateResource = useCustomFieldValueStore((s) => s.invalidateResource)
  const invalidateResources = useCustomFieldValueStore((s) => s.invalidateResources)
  const invalidateField = useCustomFieldValueStore((s) => s.invalidateField)
  const invalidateResourceType = useCustomFieldValueStore((s) => s.invalidateResourceType)

  /**
   * Invalidate after updating a single entity's field values.
   * Call this in your setValue mutation's success handler.
   */
  const onValueUpdated = useCallback(
    (resourceType: ResourceType, resourceId: string, entityDefId?: string) => {
      invalidateResource(resourceType, resourceId, entityDefId)
    },
    [invalidateResource]
  )

  /**
   * Invalidate after bulk updating multiple entities.
   * Call this after bulk operations complete.
   */
  const onBulkValuesUpdated = useCallback(
    (resourceType: ResourceType, resourceIds: string[], entityDefId?: string) => {
      invalidateResources(resourceType, resourceIds, entityDefId)
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
   * Invalidate all values for a resource type.
   * Use sparingly - e.g., after major data imports.
   */
  const onResourceTypeInvalidated = useCallback(
    (resourceType: ResourceType, entityDefId?: string) => {
      invalidateResourceType(resourceType, entityDefId)
    },
    [invalidateResourceType]
  )

  return {
    onValueUpdated,
    onBulkValuesUpdated,
    onFieldDefinitionChanged,
    onResourceTypeInvalidated,
  }
}
