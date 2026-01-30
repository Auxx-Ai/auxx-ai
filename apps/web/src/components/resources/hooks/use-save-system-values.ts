// apps/web/src/components/resources/hooks/use-save-system-values.ts

import { useCallback } from 'react'
import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldType } from '@auxx/database/types'
import { useResourceStore } from '../store/resource-store'
import { useSaveFieldValue } from './use-save-field-value'
import { parseResourceFieldId } from '@auxx/types/field'

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

      for (const [attr, value] of Object.entries(values)) {
        const resourceFieldId = systemAttributeMap[attr]
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
    [recordId, systemAttributeMap, fieldMap, saveMultipleAsync]
  )

  return { save, isPending }
}
