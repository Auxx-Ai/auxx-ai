// apps/web/src/components/fields/hooks/use-field-view.ts
'use client'

import type { FieldViewConfig, ViewContextType } from '@auxx/lib/conditions/client'
import { createDefaultFieldViewConfig } from '@auxx/lib/conditions/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import {
  useOrgFieldView,
  useViewStoreInitialized,
} from '~/components/dynamic-table/stores/store-selectors'

interface UseFieldViewOptions {
  /** Entity definition ID (e.g., 'contact', 'ticket') */
  entityDefinitionId: string
  /** Context type for this view */
  contextType: ViewContextType
  /** All available fields (used for fallback when no view exists) */
  fields: ResourceField[]
  /** Whether to enable the query */
  enabled?: boolean
}

interface UseFieldViewReturn {
  /** Current field view config (from org default or generated) */
  config: FieldViewConfig
  /** Whether an org-wide view exists */
  hasOrgView: boolean
  /** Loading state */
  isLoading: boolean
  /** Get visible fields in configured order */
  getVisibleFields: () => ResourceField[]
  /** Get all fields in configured order (for edit mode) */
  getAllFields: () => ResourceField[]
  /** Check if a specific field is visible */
  isFieldVisible: (fieldId: string) => boolean
}

/**
 * Hook for consuming org-wide field view configuration from the store.
 * Returns default config if no org view exists.
 */
export function useFieldView({
  entityDefinitionId,
  contextType,
  fields,
}: UseFieldViewOptions): UseFieldViewReturn {
  // Get field IDs for default config fallback
  const fieldIds = useMemo(() => fields.map((f) => f.resourceFieldId ?? f.id ?? f.key), [fields])

  // Check if store is initialized
  const initialized = useViewStoreInitialized()

  // Get field view from store (no API call)
  const view = useOrgFieldView(entityDefinitionId, contextType)
  const storedConfig = view?.config as FieldViewConfig | undefined

  // Loading if store not initialized yet
  const isLoading = !initialized

  // Compute effective config (from store or default)
  const config = useMemo((): FieldViewConfig => {
    if (storedConfig) return storedConfig
    return createDefaultFieldViewConfig(fieldIds)
  }, [storedConfig, fieldIds])

  // Get visible fields in configured order
  const getVisibleFields = useCallback((): ResourceField[] => {
    const { fieldVisibility, fieldOrder } = config

    // Create a map of fields by their ID
    const fieldMap = new Map(fields.map((f) => [f.resourceFieldId ?? f.id ?? f.key, f]))

    // Return fields in order, filtering by visibility
    const orderedFields: ResourceField[] = []

    // First, add fields that are in the configured order
    for (const fieldId of fieldOrder) {
      const field = fieldMap.get(fieldId)
      if (field && fieldVisibility[fieldId] !== false) {
        orderedFields.push(field)
        fieldMap.delete(fieldId)
      }
    }

    // Then add any remaining fields not in order (new fields added after view was configured)
    for (const [fieldId, field] of fieldMap) {
      if (fieldVisibility[fieldId] !== false) {
        orderedFields.push(field)
      }
    }

    return orderedFields
  }, [config, fields])

  // Get all fields in configured order (for edit mode - includes hidden fields)
  const getAllFields = useCallback((): ResourceField[] => {
    const { fieldOrder } = config

    // Create a map of fields by their ID
    const fieldMap = new Map(fields.map((f) => [f.resourceFieldId ?? f.id ?? f.key, f]))

    const orderedFields: ResourceField[] = []

    // First, add fields that are in the configured order
    for (const fieldId of fieldOrder) {
      const field = fieldMap.get(fieldId)
      if (field) {
        orderedFields.push(field)
        fieldMap.delete(fieldId)
      }
    }

    // Then add any remaining fields not in order (new fields added after view was configured)
    for (const [, field] of fieldMap) {
      orderedFields.push(field)
    }

    return orderedFields
  }, [config, fields])

  // Check if a field is visible
  const isFieldVisible = useCallback(
    (fieldId: string): boolean => {
      return config.fieldVisibility[fieldId] !== false
    },
    [config]
  )

  return {
    config,
    hasOrgView: !!view,
    isLoading,
    getVisibleFields,
    getAllFields,
    isFieldVisible,
  }
}
