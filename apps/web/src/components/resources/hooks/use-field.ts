// apps/web/src/components/resources/hooks/use-field.ts

import { useResourceStore } from '../store/resource-store'
import { useShallow } from 'zustand/react/shallow'
import type { ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { Resource } from '@auxx/lib/resources/client'

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

/**
 * Subscribe to field pending state (for showing save indicators).
 * Returns true if field has an optimistic update that hasn't been confirmed.
 *
 * @param resourceFieldId - ResourceFieldId (or null/undefined for conditional usage)
 * @returns boolean - true if field has pending optimistic updates
 *
 * @example
 * const isPending = useFieldIsPending(resourceFieldId)
 * // Show spinner or saving indicator when isPending is true
 */
export function useFieldIsPending(
  resourceFieldId: ResourceFieldId | null | undefined
): boolean {
  return useResourceStore((state) => {
    if (!resourceFieldId) return false
    return resourceFieldId in state.pendingFieldUpdates
  })
}

/**
 * Subscribe to field deleted state (for hiding fields during optimistic delete).
 * Returns true if field has been optimistically deleted but not yet confirmed.
 *
 * @param resourceFieldId - ResourceFieldId (or null/undefined for conditional usage)
 * @returns boolean - true if field has been optimistically deleted
 */
export function useFieldIsDeleted(
  resourceFieldId: ResourceFieldId | null | undefined
): boolean {
  return useResourceStore((state) => {
    if (!resourceFieldId) return false
    return state.optimisticDeletedFields.has(resourceFieldId)
  })
}

/**
 * Subscribe to specific resource properties.
 * Granular: only re-renders when selected properties change.
 *
 * @param entityDefinitionId - Entity definition ID
 * @param property - Property key to subscribe to
 * @returns Property value or undefined if resource not found
 *
 * @example
 * const name = useResourceProperty('contact', 'label')
 * const icon = useResourceProperty('contact', 'icon')
 */
export function useResourceProperty<K extends keyof Resource>(
  entityDefinitionId: string | undefined,
  property: K
): Resource[K] | undefined {
  return useResourceStore((state) => {
    if (!entityDefinitionId) return undefined
    const resource = state.getEffectiveResource(entityDefinitionId)
    return resource?.[property]
  })
}
