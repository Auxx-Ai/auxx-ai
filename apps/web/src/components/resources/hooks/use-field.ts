// apps/web/src/components/resources/hooks/use-field.ts

import { useResourceStore } from '../store/resource-store'
import { useShallow } from 'zustand/react/shallow'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/client'

/**
 * FIELD ACCESS PATTERNS - When to Use What
 *
 * 1. useField(resourceFieldId) - PREFERRED for single field access
 *    - Use when: You need one field's definition
 *    - Benefits: O(1) lookup, granular reactivity, only rerenders when THIS field changes
 *    - Example: CustomFieldCell, KanbanCardField, inline editors
 *
 * 2. useFields([resourceFieldIds]) - For multiple specific fields
 *    - Use when: You need several fields by ID
 *    - Benefits: Batch lookup, granular reactivity for each field
 *
 * 3. useResource(entityDefinitionId) - For entire resource
 *    - Use when: You need the full resource (metadata, display config, ALL fields)
 *    - Drawback: Rerenders when ANY field changes
 *    - Example: Building column definitions, resource-level operations
 *
 * 4. cellSelectionConfig.getFieldDefinition - For editing context
 *    - Use when: In cell editing context where resourceFieldId not easily available
 *    - Returns ResourceField | null from current column
 */

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
  resourceFieldId: ResourceFieldId | null | undefined
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
  resourceFieldIds: (ResourceFieldId | null | undefined)[]
): (ResourceField | undefined)[] {
  // Subscribe to specific fields with shallow comparison
  // useShallow performs shallow comparison of the returned array
  // This prevents re-renders when array contents haven't actually changed
  const fields = useResourceStore(
    useShallow((state) => {
      return resourceFieldIds.map((rfId) => {
        if (!rfId) return undefined
        return state.fieldMap[rfId]
      })
    })
  )

  return fields
}
