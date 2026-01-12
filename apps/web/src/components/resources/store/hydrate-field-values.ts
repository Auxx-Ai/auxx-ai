// apps/web/src/stores/hydrate-field-values.ts

import {
  useCustomFieldValueStore,
  buildFieldValueKey,
  type StoredFieldValue,
} from './custom-field-value-store'
import { formatToTypedInput } from '@auxx/lib/field-values/client'
import { isComputedField, type Resource, type ResourceId } from '@auxx/lib/resources/client'
import type { FieldType } from '@auxx/database/types'

interface HydrationOptions {
  resource: Resource
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
  recordData: Record<string, unknown>
}

/**
 * Hydrates all field values (system + custom) from record data into the store.
 * Called after fetching a record to populate the value store.
 *
 * This is a pure function that can be called from any context (not a hook).
 */
export function hydrateFieldValues({ resource, resourceId, recordData }: HydrationOptions): void {
  const entries: Array<{ key: string; value: StoredFieldValue }> = []

  // Process all fields (system + custom)
  for (const field of resource.fields) {
    // Skip fields without fieldType (can't convert)
    if (!field.fieldType) continue

    let rawValue: unknown

    // Handle computed fields (e.g., name -> { firstName, lastName })
    if (isComputedField(field) && field.sourceFields) {
      rawValue = Object.fromEntries(
        field.sourceFields.map((sourceKey) => [sourceKey, recordData[sourceKey] ?? ''])
      )
    } else {
      // Regular field - get value from dbColumn or key
      const valueKey = field.dbColumn || field.key
      rawValue = recordData[valueKey]
    }

    // Skip undefined values (but not null - null is a valid "empty" value)
    if (rawValue === undefined) continue

    // Handle relationship fields with nested objects (e.g., customerGroups)
    if (Array.isArray(rawValue) && field.relationship) {
      rawValue = rawValue.map((item: unknown) => {
        // Extract ID from nested relation object if present
        if (typeof item === 'object' && item !== null && 'id' in item) {
          return (item as { id: string }).id
        }
        return item
      })
    }

    // Convert to TypedFieldValue using the converter
    const typedValue = formatToTypedInput(rawValue, field.fieldType as FieldType, {
      selectOptions: field.enumValues?.map((e) => ({ value: e.dbValue, label: e.label })),
    })

    if (typedValue !== null) {
      // Use buildFieldValueKey with ResourceId directly
      const storeKey = buildFieldValueKey(resourceId, field.key)
      entries.push({ key: storeKey, value: typedValue as StoredFieldValue })
    }
  }

  // Batch update store
  if (entries.length > 0) {
    useCustomFieldValueStore.getState().setValues(entries)
  }
}

/**
 * Hydrates values for multiple records.
 * More efficient than calling hydrateFieldValues in a loop.
 */
export function hydrateMultipleRecords(
  resource: Resource,
  records: Array<{ resourceId: ResourceId; data: Record<string, unknown> }>
): void {
  const allEntries: Array<{ key: string; value: StoredFieldValue }> = []

  for (const record of records) {
    for (const field of resource.fields) {
      if (!field.fieldType) continue

      let rawValue: unknown

      if (isComputedField(field) && field.sourceFields) {
        rawValue = Object.fromEntries(
          field.sourceFields.map((sourceKey) => [sourceKey, record.data[sourceKey] ?? ''])
        )
      } else {
        const valueKey = field.dbColumn || field.key
        rawValue = record.data[valueKey]
      }

      if (rawValue === undefined) continue

      if (Array.isArray(rawValue) && field.relationship) {
        rawValue = rawValue.map((item: unknown) => {
          if (typeof item === 'object' && item !== null && 'id' in item) {
            return (item as { id: string }).id
          }
          return item
        })
      }

      const typedValue = formatToTypedInput(rawValue, field.fieldType as FieldType, {
        selectOptions: field.enumValues?.map((e) => ({ value: e.dbValue, label: e.label })),
      })

      if (typedValue !== null) {
        // Use buildFieldValueKey with ResourceId directly
        const storeKey = buildFieldValueKey(record.resourceId, field.key)
        allEntries.push({ key: storeKey, value: typedValue as StoredFieldValue })
      }
    }
  }

  if (allEntries.length > 0) {
    useCustomFieldValueStore.getState().setValues(allEntries)
  }
}
