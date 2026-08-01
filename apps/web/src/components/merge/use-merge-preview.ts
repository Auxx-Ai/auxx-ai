// apps/web/src/components/merge/use-merge-preview.ts
'use client'

import { formatToRawValue } from '@auxx/lib/field-values/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import { mergeFieldValue } from '@auxx/lib/resources/merge/client'
import { useMemo } from 'react'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import {
  useNormalizedRecordId,
  useNormalizedRecordIds,
} from '~/components/resources/utils/normalize-record-id'

/**
 * Hook to preview merge results by computing merged field values
 * from target and source entities.
 */
export function useMergePreview({
  targetRecordId: rawTargetRecordId,
  sourceRecordIds: rawSourceRecordIds,
  fields,
}: {
  targetRecordId: RecordId
  sourceRecordIds: RecordId[]
  fields: ResourceField[]
}) {
  // Canonicalize prefixes — the store is keyed by EntityDefinition-UUID
  // RecordIds, and this hook builds keys directly (not via the base hooks).
  const targetRecordId = useNormalizedRecordId(rawTargetRecordId)
  const sourceRecordIds = useNormalizedRecordIds(rawSourceRecordIds)

  const storeValues = useFieldValueStore((state) => state.values)

  return useMemo(() => {
    const mergedFields: Record<string, { value: unknown; wasModified: boolean }> = {}
    let fieldsMerged = 0

    for (const field of fields) {
      // Only merge fields that can be updated
      if (!field.capabilities.updatable) continue
      // `fieldType` drives both the value decode and the merge strategy — a
      // field without one (system resource columns) can't be merged.
      const fieldType = field.fieldType
      if (!fieldType) continue

      // Get target value from store (TypedFieldValue format)
      const targetStoreKey = buildFieldValueKey(targetRecordId, field.id)
      const targetStoreValue = storeValues[targetStoreKey]

      // EXPLICIT CONVERSION: TypedFieldValue → raw value
      const targetValue = formatToRawValue(targetStoreValue, fieldType)

      // Get source values from store (TypedFieldValue format)
      const sourceValues = sourceRecordIds.map((recordId) => {
        const sourceStoreKey = buildFieldValueKey(recordId, field.id)
        const sourceStoreValue = storeValues[sourceStoreKey]

        // EXPLICIT CONVERSION: TypedFieldValue → raw value
        return formatToRawValue(sourceStoreValue, fieldType)
      })

      // Skip fields that have no data in target or any sources
      const hasTargetData =
        targetValue != null &&
        targetValue !== '' &&
        (Array.isArray(targetValue) ? targetValue.length > 0 : true)
      const hasSourceData = sourceValues.some(
        (val) => val != null && val !== '' && (Array.isArray(val) ? val.length > 0 : true)
      )
      if (!hasTargetData && !hasSourceData) continue

      // Merge using raw values
      const result = mergeFieldValue({
        targetValue,
        sourceValues,
        fieldType,
        fieldOptions: field.options as Record<string, unknown> | undefined,
      })

      mergedFields[field.id] = result
      if (result.wasModified) fieldsMerged++
    }

    return { mergedFields, fieldsMerged }
  }, [targetRecordId, sourceRecordIds, fields, storeValues])
}
