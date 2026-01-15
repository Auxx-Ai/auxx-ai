// apps/web/src/components/resources/hooks/use-field.ts

import { useResourceStore } from '../store/resource-store'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/registry/field-types'

/**
 * Subscribe to a specific field definition.
 * Only re-renders when this field's definition changes.
 *
 * @param resourceFieldId - ResourceFieldId (or null/undefined for conditional usage)
 * @returns ResourceField or undefined if not found
 *
 * @example
 * // Basic usage
 * const emailField = useField(toResourceFieldId('contact', toFieldId('email')))
 *
 * // Dynamic usage with resource
 * const field = useField(toResourceFieldId(resource.id, fieldId))
 *
 * // Conditional usage
 * const field = useField(someCondition ? resourceFieldId : null)
 */
export function useField(
  resourceFieldId: ResourceFieldId | null | undefined,
): ResourceField | undefined {
  // Subscribe to specific field in fieldMap
  // Only re-renders when this specific field changes (due to reference stability)
  const field = useResourceStore((state) => {
    if (!resourceFieldId) return undefined
    return state.fieldMap[resourceFieldId]
  })

  return field
}

/**
 * Get multiple fields efficiently.
 * Only re-renders when any of the requested fields change.
 *
 * @param resourceFieldIds - Array of ResourceFieldId (can include null/undefined)
 * @returns Array of ResourceField (undefined for null inputs or missing fields)
 *
 * @example
 * const [emailField, nameField] = useFields([
 *   toResourceFieldId('contact', toFieldId('email')),
 *   toResourceFieldId('contact', toFieldId('firstName'))
 * ])
 */
export function useFields(
  resourceFieldIds: (ResourceFieldId | null | undefined)[],
): (ResourceField | undefined)[] {
  // Subscribe to specific fields
  const fields = useResourceStore((state) => {
    return resourceFieldIds.map((rfId) => {
      if (!rfId) return undefined
      return state.fieldMap[rfId]
    })
  })

  return fields
}
