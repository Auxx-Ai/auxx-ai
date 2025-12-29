// apps/web/src/components/resources/hooks/use-resource-fields.ts

import { useMemo } from 'react'
import { useResourceProvider } from '../providers/resource-provider'
import type { ResourceField } from '@auxx/lib/resources/client'

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
}

/**
 * Hook for accessing resource field definitions
 * Fields are loaded with resources - no separate fetch needed
 */
export function useResourceFields(resourceId: string | null): UseResourceFieldsResult {
  const { resources, isLoadingResources } = useResourceProvider()

  const fields = useMemo(() => {
    if (!resourceId) return EMPTY_FIELDS
    return resources.find((r) => r.id === resourceId)?.fields ?? EMPTY_FIELDS
  }, [resources, resourceId])

  const filterableFields = useMemo(() => fields.filter((f) => f.capabilities?.filterable), [fields])
  const sortableFields = useMemo(() => fields.filter((f) => f.capabilities?.sortable), [fields])
  const creatableFields = useMemo(() => fields.filter((f) => f.capabilities?.creatable), [fields])
  const updatableFields = useMemo(() => fields.filter((f) => f.capabilities?.updatable), [fields])

  return {
    fields,
    isLoading: isLoadingResources,
    filterableFields,
    sortableFields,
    creatableFields,
    updatableFields,
  }
}
