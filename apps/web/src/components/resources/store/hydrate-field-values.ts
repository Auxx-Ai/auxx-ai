// apps/web/src/stores/hydrate-field-values.ts

import type { FieldType } from '@auxx/database/types'
import { formatToTypedInput } from '@auxx/lib/field-values/client'
import {
  getFieldOutputKey,
  isComputedField,
  type RecordId,
  type Resource,
  type ResourceField,
} from '@auxx/lib/resources/client'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { getNormalizedRecordId } from '../utils/normalize-record-id'
import {
  buildFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
  useFieldValueStore,
} from './field-value-store'

/**
 * Derive the target entityDefinitionId for a RELATIONSHIP field so the
 * converter can build a RecordId from a raw FK string (e.g. Article.parentId).
 * Without this, hydration of relationship columns from picker rows returns null
 * and the cell stays empty.
 */
function getRelatedEntityDefinitionId(field: ResourceField): string | undefined {
  const inverse = field.relationship?.inverseResourceFieldId
  if (!inverse) return undefined
  try {
    return parseResourceFieldId(inverse as ResourceFieldId).entityDefinitionId
  } catch {
    return undefined
  }
}

/**
 * Convert one field's record-row value to the typed store shape, or `undefined`
 * to skip seeding the key entirely.
 *
 * `options.multi` scalar fields (EMAIL/URL/PHONE with `multi: true`) get
 * special handling: record-row data carries at most the denormalized PRIMARY
 * value (e.g. contact `email` via `dbColumn`), never the full FieldValue row
 * set. Seeding that scalar would (a) store a scalar where every other feed
 * stores an array and (b) block the authoritative `fieldValue.batchGet` fetch —
 * the fetch queue and cell hooks skip keys that already hold a value — so the
 * table cell would show only the primary until something else overwrote the
 * key. Skipping leaves the key `undefined`, and autoFetch delivers the full
 * ordered array. A genuine array in record data (a feed that does carry every
 * value) still hydrates, through the per-item converter via `fieldOptions`.
 */
function toHydratedTypedValue(field: ResourceField, rawValue: unknown): StoredFieldValue | null {
  if (field.options?.multi && !Array.isArray(rawValue)) return null
  return formatToTypedInput(rawValue, field.fieldType as FieldType, {
    selectOptions: field.options?.options,
    relatedEntityDefinitionId: getRelatedEntityDefinitionId(field),
    fieldOptions: field.options,
  }) as StoredFieldValue | null
}

interface HydrationOptions {
  resource: Resource
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  recordData: Record<string, unknown>
}

/**
 * Hydrates all field values (system + custom) from record data into the store.
 * Called after fetching a record to populate the value store.
 *
 * This is a pure function that can be called from any context (not a hook).
 */
export function hydrateFieldValues({
  resource,
  recordId: rawRecordId,
  recordData,
}: HydrationOptions): void {
  // Guard: canonicalize the prefix so hydrated keys match subscriber keys.
  const recordId = getNormalizedRecordId(rawRecordId)
  const entries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []

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
      // Regular field - get value from dbColumn or output key
      const valueKey = field.dbColumn || getFieldOutputKey(field)
      rawValue = recordData[valueKey]
    }

    // Skip undefined values (but not null - null is a valid "empty" value)
    if (rawValue === undefined) continue

    // Handle relationship fields with nested objects
    if (Array.isArray(rawValue) && field.relationship) {
      rawValue = rawValue.map((item: unknown) => {
        // Extract ID from nested relation object if present
        if (typeof item === 'object' && item !== null && 'id' in item) {
          return (item as { id: string }).id
        }
        return item
      })
    }

    // Convert to TypedFieldValue using the converter (multi-aware — see
    // toHydratedTypedValue for why a scalar on an options.multi field skips).
    const typedValue = toHydratedTypedValue(field, rawValue)

    if (typedValue !== null) {
      // Use field identity (resourceFieldId or id) for store key — must match what cells read
      const storeKey = buildFieldValueKey(recordId, field.resourceFieldId ?? field.id)
      entries.push({ key: storeKey, value: typedValue })
    }
  }

  // Batch update store
  if (entries.length > 0) {
    useFieldValueStore.getState().setValues(entries)
  }
}

/**
 * Hydrates values for multiple records.
 * More efficient than calling hydrateFieldValues in a loop.
 */
export function hydrateMultipleRecords(
  resource: Resource,
  records: Array<{ recordId: RecordId; data: Record<string, unknown> }>
): void {
  const allEntries: Array<{ key: FieldValueKey; value: StoredFieldValue }> = []

  for (const record of records) {
    for (const field of resource.fields) {
      if (!field.fieldType) continue

      let rawValue: unknown
      if (isComputedField(field) && field.sourceFields) {
        rawValue = Object.fromEntries(
          field.sourceFields.map((sourceKey) => [sourceKey, record.data[sourceKey] ?? ''])
        )
      } else {
        const valueKey = field.dbColumn || getFieldOutputKey(field)
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

      const typedValue = toHydratedTypedValue(field, rawValue)

      if (typedValue !== null) {
        const storeKey = buildFieldValueKey(
          getNormalizedRecordId(record.recordId),
          field.resourceFieldId ?? field.id
        )
        allEntries.push({ key: storeKey, value: typedValue })
      }
    }
  }

  if (allEntries.length > 0) {
    useFieldValueStore.getState().setValues(allEntries)
  }
}
