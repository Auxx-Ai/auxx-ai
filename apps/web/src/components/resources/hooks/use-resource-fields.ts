// apps/web/src/components/resources/hooks/use-resource-fields.ts

import { useMemo, useCallback } from 'react'
import { useResourceStore } from '../store/resource-store'
import type { ResourceField } from '@auxx/lib/resources/client'
import { toResourceFieldId, type FieldId, type ResourceFieldId } from '@auxx/types/field'

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
 */
export function useResourceFields(resourceId: string | null): UseResourceFieldsResult {
  // Subscribe directly to the fields data from the map - triggers re-render when fields change
  const fields = useResourceStore((s) =>
    resourceId ? s.resourceMap.get(resourceId)?.fields ?? EMPTY_FIELDS : EMPTY_FIELDS
  )
  const isQueryLoading = useResourceStore((s) => s.isLoading)
  const hasLoadedOnce = useResourceStore((s) => s.hasLoadedOnce)

  const filterableFields = useMemo(() => fields.filter((f) => f.capabilities?.filterable), [fields])
  const sortableFields = useMemo(() => fields.filter((f) => f.capabilities?.sortable), [fields])
  const creatableFields = useMemo(() => fields.filter((f) => f.capabilities?.creatable), [fields])
  const updatableFields = useMemo(() => fields.filter((f) => f.capabilities?.updatable), [fields])

  // If we haven't loaded resources yet, we're loading
  const isLoading = !hasLoadedOnce || isQueryLoading

  // Helper to get ResourceFieldId for a field
  const getResourceFieldId = useCallback(
    (fieldId: FieldId): ResourceFieldId | null => {
      if (!resourceId) return null
      const resource = useResourceStore.getState().resourceMap.get(resourceId)
      if (!resource) return null
      return toResourceFieldId(resource.entityDefinitionId, fieldId)
    },
    [resourceId],
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
