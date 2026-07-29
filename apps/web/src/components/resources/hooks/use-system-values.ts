// apps/web/src/components/resources/hooks/use-system-values.ts

import { formatToRawValue, isMultiValueFieldType } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { getDefinitionId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import { useResourceStore } from '../store/resource-store'
import { useNormalizedRecordId } from '../utils/normalize-record-id'
import { resolveSystemAttributeRef } from '../utils/resolve-system-attribute'
import { useFieldValues } from './use-field-values'

/**
 * Options for useSystemValues hook.
 */
interface UseSystemValuesOptions {
  /** When true, automatically fetch missing values */
  autoFetch?: boolean
  /** When false, skips all lookups and returns empty */
  enabled?: boolean
}

/**
 * Field info resolved from system attribute lookup.
 */
interface FieldInfo {
  attr: string
  resourceFieldId: ResourceFieldId
  fieldType: string
  options?: unknown
}

/**
 * Subscribe to system field values by attribute names.
 * Returns formatted values keyed by system attribute.
 *
 * Attributes are resolved against the RECORD'S OWN definition, never by name
 * alone: cloned field sets mean one attribute can belong to two definitions
 * (`inbox` and `personal_inbox` both own `inbox_name`), and a bare lookup then
 * reads the wrong definition's field and returns nothing.
 * - Most fields use their natural name: 'name', 'inbox_description', 'visibility'
 * - Universal fields use "{entityType}_{attribute}": 'thread_created_at', 'contact_id'
 *
 * @example
 * // Fetch inbox fields with auto-fetch
 * const { values, isLoading } = useSystemValues(
 *   recordId,
 *   ['name', 'inbox_description', 'inbox_color', 'visibility'],
 *   { autoFetch: true, enabled: isEditing }
 * )
 *
 * // Access values directly
 * const name = values.name as string
 */
export function useSystemValues<T extends string>(
  recordId: RecordId | null | undefined,
  systemAttributes: readonly T[],
  options: UseSystemValuesOptions = {}
): { values: Record<T, unknown>; isLoading: boolean } {
  const { autoFetch = false, enabled = true } = options

  // Get maps from store (stable references from zustand)
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const systemAttributeByDef = useResourceStore((state) => state.systemAttributeByDef)
  const ambiguousSystemAttributes = useResourceStore((state) => state.ambiguousSystemAttributes)
  const fieldMap = useResourceStore((state) => state.fieldMap)

  // Normalize the definition prefix to the real entityDefinitionId so reads
  // match the keys used when field values are written — and so attributes
  // resolve against THIS record's definition.
  const normalizedRecordId = useNormalizedRecordId(recordId)
  const entityDefinitionId = normalizedRecordId ? getDefinitionId(normalizedRecordId) : null

  // Callers overwhelmingly pass an inline array literal, which is a new
  // reference every render. Key the memo on the contents instead, or every
  // render rebuilds `fieldRefs` and re-triggers the fetch below.
  const attrsKey = JSON.stringify(systemAttributes)

  // Resolve system attributes to field info (memoized based on stable store references)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attrsKey stands in for systemAttributes
  const fieldInfos = useMemo((): FieldInfo[] => {
    if (!enabled) return []
    const maps = { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes }
    const result: FieldInfo[] = []
    for (const attr of systemAttributes) {
      const resourceFieldId = resolveSystemAttributeRef(maps, attr, entityDefinitionId)
      if (!resourceFieldId) continue
      const field = fieldMap[resourceFieldId]
      if (!field?.fieldType) continue
      result.push({ attr, resourceFieldId, fieldType: field.fieldType, options: field.options })
    }
    return result
  }, [
    enabled,
    attrsKey,
    entityDefinitionId,
    systemAttributeMap,
    systemAttributeByDef,
    ambiguousSystemAttributes,
    fieldMap,
  ])

  // Build fieldRefs array (just the ResourceFieldIds)
  const fieldRefs = useMemo(() => fieldInfos.map((f) => f.resourceFieldId), [fieldInfos])

  // Fetch values using useFieldValues with autoFetch
  const { values: rawValues, isLoading } = useFieldValues(
    normalizedRecordId ?? ('' as RecordId),
    enabled && normalizedRecordId ? fieldRefs : [],
    { autoFetch: enabled && autoFetch }
  )

  // Format and re-key by system attribute
  const values = useMemo(() => {
    const result = {} as Record<T, unknown>
    for (const { attr, resourceFieldId, fieldType, options } of fieldInfos) {
      const raw = rawValues[resourceFieldId]
      const formatted = raw !== undefined ? formatToRawValue(raw, fieldType as any) : undefined
      // SINGLE_SELECT (and single-value ACTOR) come back as single-element arrays
      // for uniform UI handling with MULTI_SELECT; collapse them to a scalar so
      // scalar consumers (selects, comparisons) round-trip correctly. Genuinely
      // multi-value types (MULTI_SELECT/TAGS/FILE/RELATIONSHIP) keep their arrays.
      result[attr as T] =
        Array.isArray(formatted) && !isMultiValueFieldType(fieldType as any, options as any)
          ? formatted[0]
          : formatted
    }
    return result
  }, [fieldInfos, rawValues])

  return { values, isLoading }
}
