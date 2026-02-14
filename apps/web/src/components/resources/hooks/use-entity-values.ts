// apps/web/src/components/resources/hooks/use-entity-values.ts

import { useMemo } from 'react'
import {
  parseRecordId,
  type RecordId,
  type StoredFieldValue,
} from '~/components/resources/store/field-value-store'
import { useFieldValues } from './use-field-values'
import { useResourceFields } from './use-resource-fields'

/** Stable empty array */
const EMPTY_FIELD_IDS: string[] = []

/** Preloaded value format expected by EntityFields */
interface PreloadedValue {
  id: string
  fieldId: string
  value: StoredFieldValue | null
}

interface UseEntityValuesOptions {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId | null | undefined
}

interface UseEntityValuesResult {
  /** Values in preloadedValues format for EntityFields */
  preloadedValues: PreloadedValue[]
  /** Raw field values by fieldId */
  fieldValues: Record<string, StoredFieldValue | undefined>
  /** Loading state for fields */
  isLoading: boolean
}

/**
 * Hook to get entity field values from the store.
 * Gets field definitions automatically via useResourceFields.
 * Returns values in the format expected by EntityFields.preloadedValues.
 */
export function useEntityValues({ recordId }: UseEntityValuesOptions): UseEntityValuesResult {
  // Parse recordId to get components
  const { entityDefinitionId, entityInstanceId } = recordId
    ? parseRecordId(recordId)
    : { entityDefinitionId: undefined, entityInstanceId: undefined }

  // Get fields for this entity definition
  const { fields, isLoading } = useResourceFields(entityDefinitionId ?? null)

  // Get active field IDs (only custom fields have id set)
  // Use stable key based on content to prevent re-renders from reference changes
  const fieldIdsKey = fields
    .filter((f) => f.id)
    .map((f) => f.id)
    .join(',')

  const activeFieldIds = useMemo(() => {
    const ids = fields.filter((f) => f.id).map((f) => f.id!)
    return ids.length > 0 ? ids : EMPTY_FIELD_IDS
  }, [fieldIdsKey])

  // Get field values from store using RecordId directly
  const rawFieldValues = useFieldValues(recordId ?? ('' as RecordId), activeFieldIds)

  // Stabilize fieldValues - only change when actual content changes
  const fieldValuesKey = JSON.stringify(rawFieldValues)
  const fieldValues = useMemo(() => rawFieldValues, [fieldValuesKey])

  // Transform to preloadedValues format
  const preloadedValues = useMemo(() => {
    if (!entityInstanceId || !activeFieldIds.length) return []

    return activeFieldIds.map((fieldId) => ({
      id: `${entityInstanceId}_${fieldId}`,
      fieldId,
      value: fieldValues[fieldId] ?? null,
    }))
  }, [entityInstanceId, activeFieldIds, fieldValues])

  return {
    preloadedValues,
    fieldValues,
    isLoading,
  }
}
