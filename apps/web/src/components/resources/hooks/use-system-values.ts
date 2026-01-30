// apps/web/src/components/resources/hooks/use-system-values.ts

import { useMemo } from 'react'
import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import { useResourceStore } from '../store/resource-store'
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
}

/**
 * Subscribe to system field values by attribute names.
 * Returns formatted values keyed by system attribute.
 *
 * All systemAttributes are globally unique:
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
  systemAttributes: T[],
  options: UseSystemValuesOptions = {}
): { values: Record<T, unknown>; isLoading: boolean } {
  const { autoFetch = false, enabled = true } = options

  // Get maps from store (stable references from zustand)
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const fieldMap = useResourceStore((state) => state.fieldMap)

  // Resolve system attributes to field info (memoized based on stable store references)
  const fieldInfos = useMemo((): FieldInfo[] => {
    if (!enabled) return []
    const result: FieldInfo[] = []
    for (const attr of systemAttributes) {
      const resourceFieldId = systemAttributeMap[attr]
      if (!resourceFieldId) continue
      const field = fieldMap[resourceFieldId]
      if (!field?.fieldType) continue
      result.push({ attr, resourceFieldId, fieldType: field.fieldType })
    }
    return result
  }, [enabled, systemAttributes, systemAttributeMap, fieldMap])

  // Build fieldRefs array (just the ResourceFieldIds)
  const fieldRefs = useMemo(() => fieldInfos.map((f) => f.resourceFieldId), [fieldInfos])

  // Fetch values using useFieldValues with autoFetch
  const { values: rawValues, isLoading } = useFieldValues(
    recordId ?? ('' as RecordId),
    enabled && recordId ? fieldRefs : [],
    { autoFetch: enabled && autoFetch }
  )

  // Format and re-key by system attribute
  const values = useMemo(() => {
    const result = {} as Record<T, unknown>
    for (const { attr, resourceFieldId, fieldType } of fieldInfos) {
      const raw = rawValues[resourceFieldId]
      result[attr as T] = raw !== undefined ? formatToRawValue(raw, fieldType as any) : undefined
    }
    return result
  }, [fieldInfos, rawValues])

  return { values, isLoading }
}
