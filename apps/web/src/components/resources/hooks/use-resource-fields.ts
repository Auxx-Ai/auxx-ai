// apps/web/src/components/resources/hooks/use-resource-fields.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldId,
  parseResourceFieldId,
  type ResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { useCallback, useMemo } from 'react'
import { useResourceStore } from '../store/resource-store'

/** Stable empty array to prevent unnecessary re-renders */
const EMPTY_FIELDS: ResourceField[] = []

interface UseResourceFieldsResult {
  /** All fields for this resource */
  fields: ResourceField[]
  /** Loading state */
  isLoading: boolean
  /** Fields that can be used in filters */
  filterableFields: ResourceField[]
  /** Fields that can be used for sorting */
  sortableFields: ResourceField[]
  /** Fields that can be set on create */
  creatableFields: ResourceField[]
  /** Fields that can be set on update */
  updatableFields: ResourceField[]
  /** Helper to get ResourceFieldId for a field */
  getResourceFieldId: (fieldId: FieldId) => ResourceFieldId | null
}

/**
 * Hook for accessing resource field definitions
 * Fields are loaded with resources - no separate fetch needed
 * Returns effective fields (server + optimistic overlay)
 */
export function useResourceFields(
  entityDefinitionIdOrApiSlug: string | null | undefined
): UseResourceFieldsResult {
  // Subscribe to stable state pieces instead of calling getEffectiveResource
  // which creates new objects on every call and causes infinite loops
  const resource = useResourceStore((s) =>
    entityDefinitionIdOrApiSlug ? s.resourceMap.get(entityDefinitionIdOrApiSlug) : undefined
  )
  const fieldMap = useResourceStore((s) => s.fieldMap)
  const optimisticDeletedFields = useResourceStore((s) => s.optimisticDeletedFields)
  const optimisticNewFields = useResourceStore((s) => s.optimisticNewFields)
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)

  // Compute effective fields with useMemo for stable reference
  const fields = useMemo(() => {
    if (!resource || !entityDefinitionIdOrApiSlug) return EMPTY_FIELDS

    const effectiveFields: ResourceField[] = []

    // Add fields from resource with optimistic overlay from fieldMap
    for (const field of resource.fields) {
      const key = field.resourceFieldId || toResourceFieldId(resource.id, field.id)
      if (optimisticDeletedFields.has(key)) continue

      const effectiveField = fieldMap[key]
      if (effectiveField) {
        effectiveFields.push(effectiveField)
      }
    }

    // Add optimistic new fields for this resource
    // Use both resource.id and resource.entityDefinitionId for matching (they should be equal but handle edge cases)
    const resourceId = resource.id
    const resourceEntityDefId = resource.entityDefinitionId
    for (const [key, field] of Object.entries(optimisticNewFields) as Array<
      [ResourceFieldId, ResourceField]
    >) {
      const { entityDefinitionId: fieldEntityDefId } = parseResourceFieldId(key)
      const matchesResource =
        fieldEntityDefId === resourceId || fieldEntityDefId === resourceEntityDefId
      if (matchesResource && !optimisticDeletedFields.has(key)) {
        effectiveFields.push(field)
      }
    }

    return effectiveFields
  }, [
    resource,
    fieldMap,
    optimisticDeletedFields,
    optimisticNewFields,
    entityDefinitionIdOrApiSlug,
  ])

  const filterableFields = useMemo(() => fields.filter((f) => f.capabilities?.filterable), [fields])
  const sortableFields = useMemo(() => fields.filter((f) => f.capabilities?.sortable), [fields])
  const creatableFields = useMemo(() => fields.filter((f) => f.capabilities?.creatable), [fields])
  const updatableFields = useMemo(() => fields.filter((f) => f.capabilities?.updatable), [fields])

  // If we haven't loaded resources yet, we're loading
  const isLoading = !hasLoadedOnce || isQueryLoading

  // Helper to get ResourceFieldId for a field
  const getResourceFieldId = useCallback(
    (fieldId: FieldId): ResourceFieldId | null => {
      if (!entityDefinitionIdOrApiSlug) return null
      const resource = useResourceStore.getState().resourceMap.get(entityDefinitionIdOrApiSlug)
      if (!resource) return null
      return toResourceFieldId(resource.entityDefinitionId, fieldId)
    },
    [entityDefinitionIdOrApiSlug]
  )

  return {
    fields,
    isLoading,
    filterableFields,
    sortableFields,
    creatableFields,
    updatableFields,
    getResourceFieldId,
  }
}
