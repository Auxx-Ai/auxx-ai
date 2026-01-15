// apps/web/src/components/merge/use-merge-preview.ts
'use client'

import { useMemo } from 'react'
import { mergeFieldValue } from '@auxx/lib/resources/merge/client'
import {
  useCustomFieldValueStore,
  buildFieldValueKey,
} from '~/components/resources/store/custom-field-value-store'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import type { ResourceId } from '@auxx/lib/resources/client'
import type { FieldType } from '@auxx/database/types'

/**
 * Hook to preview merge results by computing merged field values
 * from target and source entities.
 */
export function useMergePreview({
  targetResourceId,
  sourceResourceIds,
  fields,
}: {
  targetResourceId: ResourceId
  sourceResourceIds: ResourceId[]
  fields: Array<{
    id: string
    label: string
    fieldType: FieldType
    options?: Record<string, unknown>
    isSystem?: boolean
  }>
}) {
  const storeValues = useCustomFieldValueStore((state) => state.values)

  return useMemo(() => {
    const mergedFields: Record<string, { value: unknown; wasModified: boolean }> = {}
    let fieldsMerged = 0

    for (const field of fields) {
      // Only merge fields that can be updated
      if (!field.capabilities?.updatable) continue

      // Get target value from store (TypedFieldValue format)
      const targetStoreKey = buildFieldValueKey(targetResourceId, field.id)
      const targetStoreValue = storeValues[targetStoreKey]

      // EXPLICIT CONVERSION: TypedFieldValue → raw value
      const targetValue = formatToRawValue(targetStoreValue, field.fieldType)

      // Get source values from store (TypedFieldValue format)
      const sourceValues = sourceResourceIds.map((resourceId) => {
        const sourceStoreKey = buildFieldValueKey(resourceId, field.id)
        const sourceStoreValue = storeValues[sourceStoreKey]

        // EXPLICIT CONVERSION: TypedFieldValue → raw value
        return formatToRawValue(sourceStoreValue, field.fieldType)
      })

      // Skip fields that have no data in target or any sources
      const hasTargetData = targetValue != null && targetValue !== '' &&
        (Array.isArray(targetValue) ? targetValue.length > 0 : true)
      const hasSourceData = sourceValues.some(val =>
        val != null && val !== '' && (Array.isArray(val) ? val.length > 0 : true)
      )
      if (!hasTargetData && !hasSourceData) continue

      // Merge using raw values
      const result = mergeFieldValue({
        targetValue,
        sourceValues,
        fieldType: field.fieldType,
        fieldOptions: field.options,
      })

      mergedFields[field.id] = result
      if (result.wasModified) fieldsMerged++
    }

    return { mergedFields, fieldsMerged }
  }, [targetResourceId, sourceResourceIds, fields, storeValues])
}
