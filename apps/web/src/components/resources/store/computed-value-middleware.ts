// apps/web/src/components/resources/store/computed-value-middleware.ts

import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import type { TypedFieldValue } from '@auxx/types/field-value'
import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { computedFieldRegistry } from './computed-field-registry'
import { computedValueCache } from './computed-value-cache'
import { buildFieldValueKey, type FieldValueKey, type StoredFieldValue } from './field-value-store'

/**
 * Extract raw value from StoredFieldValue for use in calc expressions.
 * Handles TypedFieldValue discriminated union and raw primitives.
 */
function extractRawValue(stored: StoredFieldValue | undefined): unknown {
  if (stored === undefined || stored === null) return undefined

  // Handle raw primitives (string, number, boolean)
  if (typeof stored !== 'object') return stored

  // Handle arrays (multi-select, tags, etc.)
  if (Array.isArray(stored)) {
    // For arrays, extract values from each item
    return stored.map((item) => extractRawValue(item))
  }

  // Handle TypedFieldValue discriminated union
  const typed = stored as TypedFieldValue
  switch (typed.type) {
    case 'text':
      return typed.value
    case 'number':
      return typed.value
    case 'boolean':
      return typed.value
    case 'date':
      return typed.value // ISO string
    case 'option':
      return typed.label ?? (typed as { optionId?: string }).optionId ?? null
    case 'json':
      return typed.value
    case 'relationship':
      return (typed as { displayName?: string; recordId?: string }).displayName ?? typed.recordId ?? null
    default:
      // Handle objects with value property (fallback)
      if ('value' in stored) {
        return (stored as { value: unknown }).value
      }
      return null
  }
}

/**
 * Result from computing a CALC field value.
 */
interface ComputeResult {
  value: unknown
  sourceKeys: string[]
}

/**
 * Compute value for a CALC field using source field values from the store.
 * Returns null if the field is not a CALC field or is disabled.
 * Returns undefined if source values are not yet loaded.
 */
function computeFieldValue(
  recordId: RecordId,
  fieldId: ResourceFieldId,
  values: Record<FieldValueKey, StoredFieldValue>
): ComputeResult | null | undefined {
  const config = computedFieldRegistry.getConfig(fieldId)
  if (!config) return null

  if (config.disabled) {
    return { value: null, sourceKeys: [] }
  }

  const sourceValues: Record<string, unknown> = {}
  const sourceKeys: string[] = []
  let hasMissingSource = false

  for (const [placeholder, sourceFieldId] of Object.entries(config.sourceFields)) {
    const sourceKey = buildFieldValueKey(recordId, sourceFieldId)
    sourceKeys.push(sourceKey)

    const stored = values[sourceKey]
    const rawValue = extractRawValue(stored)

    // Check if source value is still loading (undefined means not yet fetched)
    if (stored === undefined) {
      hasMissingSource = true
    }

    sourceValues[placeholder] = rawValue
  }

  // If any source values are missing, return undefined (still loading)
  if (hasMissingSource) {
    return undefined
  }

  try {
    const computed = evaluateCalcExpression(config.expression, sourceValues)
    return { value: computed, sourceKeys }
  } catch (error) {
    console.error(`Error computing CALC field ${fieldId}:`, error)
    return { value: null, sourceKeys }
  }
}

/**
 * Wrap a computed value in TypedFieldValue format based on result type.
 */
function wrapComputedValue(value: unknown, fieldId: ResourceFieldId): StoredFieldValue {
  const config = computedFieldRegistry.getConfig(fieldId)
  const resultType = config?.resultFieldType ?? 'TEXT'

  // Handle null/undefined
  if (value === null || value === undefined) {
    return { type: 'text', value: '' } as TypedFieldValue
  }

  switch (resultType) {
    case 'NUMBER':
    case 'CURRENCY':
      return { type: 'number', value: Number(value) || 0 } as TypedFieldValue
    case 'CHECKBOX':
      return { type: 'boolean', value: Boolean(value) } as TypedFieldValue
    case 'TEXT':
    default:
      return { type: 'text', value: String(value ?? '') } as TypedFieldValue
  }
}

/**
 * Get field value, computing on-demand for CALC fields.
 * This is the main entry point for accessing field values with computed support.
 *
 * @param recordId - The record to get the value for
 * @param fieldId - The field ID (ResourceFieldId format)
 * @param values - The current field values from the store
 * @returns StoredFieldValue if available, undefined if loading, or the regular stored value for non-CALC fields
 */
export function getFieldValueWithComputed(
  recordId: RecordId,
  fieldId: ResourceFieldId,
  values: Record<FieldValueKey, StoredFieldValue>
): StoredFieldValue | undefined {
  // Check if this is a computed field
  if (!computedFieldRegistry.isComputed(fieldId)) {
    // Regular field - return from store
    const key = buildFieldValueKey(recordId, fieldId)
    return values[key]
  }

  // Check cache first
  if (computedValueCache.has(recordId, fieldId)) {
    const cached = computedValueCache.get(recordId, fieldId)
    return wrapComputedValue(cached, fieldId)
  }

  // Compute value
  const result = computeFieldValue(recordId, fieldId, values)

  // null means not a CALC field or disabled
  if (result === null) {
    return wrapComputedValue(null, fieldId)
  }

  // undefined means source values not yet loaded
  if (result === undefined) {
    return undefined
  }

  // Cache the result
  computedValueCache.set(recordId, fieldId, result.value, result.sourceKeys)

  return wrapComputedValue(result.value, fieldId)
}

/**
 * Invalidate computed value cache when source values change.
 * Call this when field values are updated in the store.
 */
export function invalidateComputedCacheForKeys(keys: string[]): void {
  for (const key of keys) {
    computedValueCache.invalidateBySourceKey(key)
  }
}

/**
 * Invalidate all computed values for a record.
 * Call this when a record is deleted or fully refreshed.
 */
export function invalidateComputedCacheForRecord(recordId: RecordId): void {
  computedValueCache.invalidateByRecord(recordId)
}

/**
 * Clear the entire computed value cache.
 * Call this on logout, org switch, etc.
 */
export function clearComputedCache(): void {
  computedValueCache.clear()
}
