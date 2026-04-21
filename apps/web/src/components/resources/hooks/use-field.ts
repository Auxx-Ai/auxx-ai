// apps/web/src/components/resources/hooks/use-field.ts

import type { FieldType } from '@auxx/database/types'
import type { Resource, ResourceField } from '@auxx/lib/resources/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { type ResourceFieldId, toFieldId, toResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useResourceStore } from '../store/resource-store'

/**
 * Extended ResourceField with effectiveFieldType for CALC fields.
 */
export interface ResourceFieldWithEffective extends ResourceField {
  /** The effective field type for rendering - for CALC fields, this is the resultFieldType */
  effectiveFieldType: FieldType
}

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
 * Returns extended field with effectiveFieldType for CALC field rendering.
 *
 * @param resourceFieldId - ResourceFieldId (or null/undefined for conditional usage)
 * @returns ResourceFieldWithEffective or undefined if not found
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
 *
 * // CALC field - use effectiveFieldType for rendering
 * const calcField = useField('order:total')
 * // calcField.fieldType === 'CALC'
 * // calcField.effectiveFieldType === 'CURRENCY' (resultFieldType from calc options)
 */
export function useField(
  resourceFieldId: ResourceFieldId | null | undefined
): ResourceFieldWithEffective | undefined {
  // Subscribe to specific field in fieldMap
  // Only re-renders when this specific field changes (due to reference stability)
  const field = useResourceStore((state) => {
    if (!resourceFieldId) return undefined
    return state.fieldMap[resourceFieldId]
  })

  // Add effectiveFieldType for CALC fields
  return useMemo(() => {
    if (!field) return undefined

    const effectiveFieldType =
      field.fieldType === 'CALC'
        ? ((field.options?.calc?.resultFieldType as FieldType) ?? 'TEXT')
        : field.fieldType

    return {
      ...field,
      effectiveFieldType,
    }
  }, [field])
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
export function useFieldIsPending(resourceFieldId: ResourceFieldId | null | undefined): boolean {
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
export function useFieldIsDeleted(resourceFieldId: ResourceFieldId | null | undefined): boolean {
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
 * @param properties - Single property key or array of property keys to subscribe to
 * @returns Single value for single property, or Pick object for array of properties
 *
 * @example
 * // Single property
 * const name = useResourceProperty('contact', 'label')
 * const icon = useResourceProperty('contact', 'icon')
 *
 * // Multiple properties
 * const { icon, color } = useResourceProperty('contact', ['icon', 'color'])
 * const { label, plural, icon } = useResourceProperty(entityDefId, ['label', 'plural', 'icon'])
 */
export function useResourceProperty<K extends keyof Resource>(
  entityDefinitionId: string | null | undefined,
  properties: K
): Resource[K] | undefined
export function useResourceProperty<K extends keyof Resource>(
  entityDefinitionId: string | null | undefined,
  properties: K[]
): Pick<Resource, K> | undefined
export function useResourceProperty<K extends keyof Resource>(
  entityDefinitionId: string | null | undefined,
  properties: K | K[]
): Resource[K] | Pick<Resource, K> | undefined {
  return useResourceStore(
    useShallow((state) => {
      if (!entityDefinitionId) return undefined
      const resource = state.getEffectiveResource(entityDefinitionId)
      if (!resource) return undefined

      // Single property - return value directly
      if (!Array.isArray(properties)) {
        return resource[properties]
      }

      // Multiple properties - return picked object
      const result = {} as Pick<Resource, K>
      for (const key of properties) {
        result[key] = resource[key]
      }
      return result
    })
  )
}

/**
 * Subscribe to a specific select option within a field.
 * Works for SINGLE_SELECT, MULTI_SELECT, TAGS fields.
 * Updates only when THIS option's data changes.
 *
 * @param resourceFieldId - The field containing the options
 * @param optionValue - The option's value (unique identifier)
 * @returns SelectOption or null if not found
 *
 * @example
 * // Kanban column
 * const option = useFieldSelectOption(resourceFieldId, columnId)
 *
 * // Tag display
 * const tag = useFieldSelectOption(tagFieldId, tagValue)
 */
export function useFieldSelectOption(
  resourceFieldId: ResourceFieldId | null | undefined,
  optionValue: string | undefined
): SelectOption | null {
  const field = useField(resourceFieldId)

  if (!optionValue || !field?.options?.options) return null

  const options = field.options.options as SelectOption[]
  return options.find((o) => o.value === optionValue) ?? null
}

/**
 * Subscribe to a system field by its systemAttribute.
 * Returns the field with the actual CustomField UUID (not static registry key).
 *
 * All systemAttributes are globally unique:
 * - Most fields use their natural name: 'thread_tags', 'primary_email', 'ticket_status'
 * - Universal fields use "{entityType}_{attribute}": 'thread_created_at', 'contact_id'
 *
 * @param systemAttribute - The system attribute (e.g., 'thread_tags', 'thread_created_at')
 * @returns ResourceFieldWithEffective or undefined if not found
 *
 * @example
 * const tagsField = useSystemField('thread_tags')
 * const emailField = useSystemField('primary_email')
 * const threadCreatedAt = useSystemField('thread_created_at')
 * const contactId = useSystemField('contact_id')
 */
export function useSystemField(
  systemAttribute: string | null | undefined
): ResourceFieldWithEffective | undefined {
  // Look up the ResourceFieldId from systemAttributeMap
  const resourceFieldId = useResourceStore((state) => {
    if (!systemAttribute) return undefined
    return state.systemAttributeMap[systemAttribute]
  })

  // Delegate to useField for actual field retrieval
  return useField(resourceFieldId)
}

/**
 * Resolve a ResourceField by the "id" shape that external callers (AI tools,
 * imports, webhooks) use — systemAttribute for system fields, CustomField UUID
 * for custom fields. Matches the `id` shape returned by `list_entity_fields`.
 *
 * O(1) via systemAttributeMap → fieldMap. Reactive, granular.
 *
 * @param entityDefinitionId - Entity the key belongs to (needed for custom-field UUIDs)
 * @param key - Either systemAttribute ('ticket_status') or CustomField UUID
 * @returns ResourceFieldWithEffective or undefined if the key doesn't resolve
 *
 * @example
 * const field = useFieldByKey(entityDefinitionId, 'ticket_status') // system
 * const field = useFieldByKey(entityDefinitionId, 'abc123-uuid')   // custom
 */
export function useFieldByKey(
  entityDefinitionId: string | null | undefined,
  key: string | null | undefined
): ResourceFieldWithEffective | undefined {
  const resourceFieldId = useResourceStore((state) => {
    if (!key) return undefined
    const sysRfId = state.systemAttributeMap[key]
    if (sysRfId) return sysRfId
    if (!entityDefinitionId) return undefined
    return toResourceFieldId(entityDefinitionId, toFieldId(key))
  })

  return useField(resourceFieldId)
}
