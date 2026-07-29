// apps/web/src/components/resources/hooks/use-save-system-values.ts

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/lib/resources/client'
import { parseResourceFieldId } from '@auxx/types/field'
import { useCallback } from 'react'
import { useResourceStore } from '../store/resource-store'
import { resolveSystemAttributeForRecord } from '../utils/resolve-system-attribute'
import { useSaveFieldValue } from './use-save-field-value'

/**
 * Sugar hook for saving system field values with optimistic updates.
 * Resolves system attributes to ResourceFieldIds and delegates to useSaveFieldValue.
 *
 * @example
 * const { save, isPending } = useSaveSystemValues(recordId)
 *
 * await save({
 *   name: 'New Name',
 *   inbox_description: 'Description',
 *   visibility: 'org_members',
 * })
 */
export function useSaveSystemValues(recordId: RecordId | null | undefined) {
  // Get maps from store
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const systemAttributeByDef = useResourceStore((state) => state.systemAttributeByDef)
  const ambiguousSystemAttributes = useResourceStore((state) => state.ambiguousSystemAttributes)
  const fieldMap = useResourceStore((state) => state.fieldMap)

  // Use existing save field value hook
  const { saveMultipleAsync, isPending } = useSaveFieldValue()

  /**
   * Save multiple system field values with optimistic updates.
   * @param values - Record of systemAttribute -> value
   * @returns true if all saves succeeded
   */
  const save = useCallback(
    async (values: Record<string, unknown>): Promise<boolean> => {
      if (!recordId) return false

      // Resolve system attributes to field info
      const fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }> = []

      // Resolve against the record's own definition — a bare lookup can return
      // a different definition's field, and writing THAT id lands a field value
      // bound to the wrong definition.
      const maps = { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes }

      for (const [attr, value] of Object.entries(values)) {
        const resourceFieldId = resolveSystemAttributeForRecord(maps, attr, recordId)
        if (!resourceFieldId) {
          console.warn(`[useSaveSystemValues] Unknown system attribute: ${attr}`)
          continue
        }

        const field = fieldMap[resourceFieldId]
        if (!field?.fieldType) {
          console.warn(`[useSaveSystemValues] Field not found: ${resourceFieldId}`)
          continue
        }

        // Extract fieldId from ResourceFieldId
        const { fieldId } = parseResourceFieldId(resourceFieldId)

        fieldValues.push({
          fieldId,
          value,
          fieldType: field.fieldType as FieldType,
        })
      }

      if (fieldValues.length === 0) return false

      return saveMultipleAsync(recordId, fieldValues)
    },
    [
      recordId,
      systemAttributeMap,
      systemAttributeByDef,
      ambiguousSystemAttributes,
      fieldMap,
      saveMultipleAsync,
    ]
  )

  return { save, isPending }
}
