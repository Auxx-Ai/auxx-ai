// apps/web/src/components/custom-fields/hooks/use-custom-field-mutations.tsx

import type { FieldType, FieldType as FieldTypeEnum } from '@auxx/database/types'
import { PRIMARY_DISPLAY_ELIGIBLE_TYPES } from '@auxx/lib/custom-fields/client'
import type { FieldCapabilities, ResourceField } from '@auxx/lib/resources/client'
import { mapFieldTypeToBaseType } from '@auxx/lib/workflow-engine/client'
import {
  getInverseFieldId,
  type RelationshipConfig,
  type SelectOption,
  type TargetTimeInStatus,
} from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import { parseResourceFieldId, toFieldId, toResourceFieldId } from '@auxx/types/field'
import { toastError, toastInfo, toastSuccess } from '@auxx/ui/components/toast'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useRef } from 'react'
import { useEntityDefinitionMutations } from '~/components/resources/hooks/use-entity-definition-mutations'
import { useField } from '~/components/resources/hooks/use-field'
import { getResourceStoreState } from '~/components/resources/store/resource-store'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

/** Props for useCustomFieldMutations hook */
interface UseCustomFieldMutationsProps {
  /** Entity definition ID - system resource (e.g. 'contact') or custom entity UUID */
  entityDefinitionId: string | undefined
}

/**
 * Hook for managing custom field mutations (create, update, delete).
 * Uses optimistic updates via the resource store for instant UI feedback.
 */
export function useCustomFieldMutations({ entityDefinitionId }: UseCustomFieldMutationsProps) {
  const utils = api.useUtils()
  const posthog = useAnalytics()

  /** Ref to prevent double-firing auto-set of primary display field */
  const autoSetInFlight = useRef(false)

  /** Use entity definition mutations for optimistic display field updates */
  const { updateEntity } = useEntityDefinitionMutations()

  /** Invalidate custom field queries to ensure components using direct queries get updated */
  const invalidateCustomFieldQueries = () => {
    utils.customField.getAll.invalidate()
    utils.customField.getByEntityDefinition.invalidate()
  }

  const createField = api.customField.create.useMutation({
    onMutate: async (variables) => {
      // Use entityDefinitionId from hook props, or fall back to variables
      const effectiveEntityDefId = entityDefinitionId || variables.entityDefinitionId
      if (!effectiveEntityDefId) return

      const store = getResourceStoreState()

      // Generate temp ID for optimistic field
      const tempId = `temp_${Date.now()}`
      const tempKey = toResourceFieldId(effectiveEntityDefId, toFieldId(tempId))

      // Determine base type from field type
      const baseType = mapFieldTypeToBaseType(variables.type)

      // Build capabilities (defaults for custom fields)
      const capabilities: FieldCapabilities = {
        filterable: true,
        sortable: true,
        creatable: true,
        updatable: true,
        configurable: true,
        required: variables.required ?? false,
        computed: false,
        unique: variables.isUnique ?? false,
      }

      // Calculate sortOrder to place new field at the end of the list
      const existingFields = Object.values(store.fieldMap).filter((field) => {
        const { entityDefinitionId: fieldEntityDefId } = parseResourceFieldId(field.resourceFieldId)
        return fieldEntityDefId === effectiveEntityDefId
      })
      const sortedFields = existingFields.sort((a, b) =>
        (a.sortOrder ?? '').localeCompare(b.sortOrder ?? '')
      )
      const lastSortOrder =
        sortedFields.length > 0 ? (sortedFields[sortedFields.length - 1]?.sortOrder ?? null) : null
      const newSortOrder = generateKeyBetween(lastSortOrder, null)

      // Create optimistic field shape matching ResourceField
      const optimisticField: ResourceField = {
        id: toFieldId(tempId),
        resourceFieldId: tempKey,
        key: variables.name,
        label: variables.name,
        name: variables.name,
        type: baseType,
        fieldType: variables.type as FieldTypeEnum,
        description: variables.description ?? undefined,
        required: variables.required ?? false,
        isUnique: variables.isUnique ?? false,
        sortOrder: newSortOrder,
        active: true,
        isSystem: false,
        showInPanel: true,
        capabilities,
        options: Array.isArray(variables.options) ? { options: variables.options } : undefined,
      }

      store.addOptimisticField(tempKey, optimisticField)
      return { tempKey, tempId }
    },

    onSuccess: (result, variables, context) => {
      // Use entityDefinitionId from hook props, or fall back to variables
      const effectiveEntityDefId = entityDefinitionId || variables.entityDefinitionId
      if (!context || !effectiveEntityDefId) return
      const store = getResourceStoreState()

      // Build the server field's key
      const serverKey = toResourceFieldId(effectiveEntityDefId, toFieldId(result.id))

      // Determine base type from field type
      const baseType = mapFieldTypeToBaseType(result.type)

      // Build capabilities from server response
      const capabilities: FieldCapabilities = {
        filterable: true,
        sortable: true,
        creatable: true,
        updatable: true,
        configurable: !result.systemAttribute,
        required: result.required,
        computed: false,
        unique: result.isUnique,
      }

      // Extract options from server response
      const rawOptions = result.options as {
        options?: { value: string; label: string; color?: string }[]
        relationship?: RelationshipConfig
      }

      // Extract inverse field ID for fetching the inverse field after creation
      const inverseFieldIdValue = rawOptions?.relationship
        ? getInverseFieldId(rawOptions.relationship)
        : null

      // Transform server response to ResourceField format
      const serverField: ResourceField = {
        id: toFieldId(result.id),
        resourceFieldId: serverKey,
        key: result.name,
        label: result.name,
        name: result.name,
        type: baseType,
        fieldType: result.type as FieldTypeEnum,
        description: result.description ?? undefined,
        required: result.required,
        isUnique: result.isUnique,
        sortOrder: result.sortOrder ?? undefined,
        active: true,
        isSystem: !!result.systemAttribute,
        showInPanel: true,
        capabilities,
        options: {
          options: rawOptions?.options,
          // Pass through raw RelationshipConfig - consumers derive values using helpers
          relationship: rawOptions?.relationship,
        },
        // Pass through raw RelationshipConfig
        relationship: rawOptions?.relationship,
      }

      // Confirm the optimistic create (replaces temp with server data)
      store.confirmFieldCreate(context.tempKey, serverKey, serverField)

      // For relationship fields, fetch the inverse field to add to store
      if (result.type === 'RELATIONSHIP' && inverseFieldIdValue) {
        utils.customField.getByIds
          .fetch({
            fieldIds: [toFieldId(inverseFieldIdValue)],
          })
          .then((fields) => {
            for (const field of fields) {
              const invBaseType = mapFieldTypeToBaseType(field.type)
              const invOptions = field.options as {
                options?: { value: string; label: string; color?: string }[]
                relationship?: RelationshipConfig
              }

              const invField: ResourceField = {
                id: toFieldId(field.id),
                resourceFieldId: toResourceFieldId(field.entityDefinitionId!, toFieldId(field.id)),
                key: field.name,
                label: field.name,
                name: field.name,
                type: invBaseType,
                fieldType: field.type as FieldTypeEnum,
                description: field.description ?? undefined,
                required: field.required,
                isUnique: field.isUnique,
                sortOrder: field.sortOrder ?? undefined,
                active: true,
                isSystem: !!field.systemAttribute,
                showInPanel: true,
                capabilities: {
                  filterable: true,
                  sortable: true,
                  creatable: true,
                  updatable: true,
                  configurable: !field.systemAttribute,
                  required: field.required,
                  computed: false,
                  unique: field.isUnique,
                },
                options: {
                  options: invOptions?.options,
                  // Pass through raw RelationshipConfig - consumers derive values using helpers
                  relationship: invOptions?.relationship,
                },
                // Pass through raw RelationshipConfig
                relationship: invOptions?.relationship,
              }

              store.applyFieldFromServer(
                toResourceFieldId(field.entityDefinitionId!, toFieldId(field.id)),
                invField
              )
            }
          })
          .catch((err) => {
            console.warn('[useCustomFieldMutations] Failed to fetch inverse field:', err)
          })
      }

      // Only invalidate custom field queries, not full resource list
      invalidateCustomFieldQueries()

      posthog?.capture('custom_field_created', {
        field_type: result.type,
        entity: effectiveEntityDefId,
      })
      toastSuccess({
        title: 'Custom field created',
        description: 'The custom field has been created successfully',
      })

      // Auto-set primaryDisplayField if entity doesn't have one and field type is eligible
      const resource = store.resourceMap.get(effectiveEntityDefId)
      if (
        resource &&
        !resource.display.primaryDisplayField &&
        !autoSetInFlight.current &&
        PRIMARY_DISPLAY_ELIGIBLE_TYPES.includes(result.type as FieldType)
      ) {
        autoSetInFlight.current = true
        updateEntity.mutate(
          { id: effectiveEntityDefId, data: { primaryDisplayFieldId: result.id } },
          {
            onSettled: () => {
              autoSetInFlight.current = false
            },
          }
        )
        toastInfo({
          title: `"${result.name}" set as display field`,
          description: 'You can change this in entity settings.',
        })
      }
    },

    onError: (error, _variables, context) => {
      if (context) {
        getResourceStoreState().rollbackFieldCreate(context.tempKey)
      }

      const code = (error.data as { code?: string } | undefined)?.code
      if (code === 'DUPLICATE_FIELD_NAME') {
        toastError({
          title: 'Field already exists',
          description: 'A field with this name already exists on this entity.',
        })
      } else {
        toastError({ title: 'Error creating custom field', description: error.message })
      }
    },
  })

  const updateField = api.customField.update.useMutation({
    onMutate: async (variables) => {
      if (!entityDefinitionId) return

      const store = getResourceStoreState()
      const key = variables.resourceFieldId

      // Increment version for race condition handling
      const version = store.incrementFieldVersion(key)

      // Apply optimistic update immediately
      // Note: Only include properties that were actually provided in the mutation
      const optimisticUpdates: Partial<ResourceField> = {}
      if (variables.name !== undefined) {
        optimisticUpdates.label = variables.name
        optimisticUpdates.name = variables.name
      }
      if (variables.description !== undefined) optimisticUpdates.description = variables.description
      if (variables.required !== undefined) optimisticUpdates.required = variables.required
      if (variables.isUnique !== undefined) optimisticUpdates.isUnique = variables.isUnique
      if (variables.sortOrder !== undefined) optimisticUpdates.sortOrder = variables.sortOrder
      if (variables.active !== undefined) optimisticUpdates.active = variables.active
      if (variables.options !== undefined) {
        // Handle options - can be SelectOption[], file config, etc.
        optimisticUpdates.options = Array.isArray(variables.options)
          ? { options: variables.options }
          : variables.options
      }

      store.setFieldOptimistic(key, optimisticUpdates)

      // If updating inverse name, optimistically update inverse field too
      let inverseKey: ResourceFieldId | null = null
      if (variables.inverseName !== undefined) {
        const currentField = store.fieldMap[key]
        const relationshipConfig = currentField?.options?.relationship as
          | RelationshipConfig
          | undefined
        if (relationshipConfig?.inverseResourceFieldId) {
          inverseKey = relationshipConfig.inverseResourceFieldId
          store.setFieldOptimistic(inverseKey, {
            label: variables.inverseName,
            name: variables.inverseName,
          })
        }
      }

      return { key, version, inverseKey }
    },

    onSuccess: (_serverField, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Check if this mutation is still relevant (not superseded by newer)
      if (context.version < store.getFieldVersion(context.key)) {
        return // Stale - a newer mutation is in flight
      }

      // Get the effective field (includes our optimistic update) and promote it to serverFieldMap
      // This ensures refetches with stale data don't overwrite our optimistic update
      const effectiveField = store.fieldMap[context.key]
      store.confirmFieldUpdate(context.key, effectiveField)

      // Confirm inverse field update if it was optimistically updated
      if (context.inverseKey) {
        const effectiveInverseField = store.fieldMap[context.inverseKey]
        if (effectiveInverseField) {
          store.confirmFieldUpdate(context.inverseKey, effectiveInverseField)
        }
      }

      // No need for full invalidation - we've updated the store directly
      // Only invalidate the specific custom field queries in case other components need them
      invalidateCustomFieldQueries()
    },

    onError: (error, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Check if this mutation is still relevant
      if (context.version < store.getFieldVersion(context.key)) {
        return // Superseded by newer mutation
      }

      // Rollback to original
      store.rollbackFieldUpdate(context.key)

      // Rollback inverse field if it was optimistically updated
      if (context.inverseKey) {
        store.rollbackFieldUpdate(context.inverseKey)
      }

      toastError({ title: 'Error updating custom field', description: error.message })
    },
  })

  const deleteField = api.customField.delete.useMutation({
    onMutate: async (variables) => {
      if (!entityDefinitionId) return

      const store = getResourceStoreState()
      const key = variables.resourceFieldId

      // Mark field as deleted optimistically
      store.markFieldDeleted(key)

      return { key }
    },

    onSuccess: (_result, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Confirm deletion succeeded
      store.confirmFieldDelete(context.key)

      // Only invalidate custom field queries, not full resource list
      // The store is already updated via optimistic delete
      invalidateCustomFieldQueries()

      toastSuccess({
        title: 'Custom field deleted',
        description: 'The custom field has been deleted successfully',
      })
    },

    onError: (error, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Rollback - make field visible again
      store.rollbackFieldDelete(context.key)

      toastError({ title: 'Error deleting custom field', description: error.message })
    },
  })

  /**
   * Reorder a field via drag-and-drop.
   * Computes new sortOrder by finding valid neighbors (skips fields without sortOrder).
   *
   * @param fields - The list of fields being reordered
   * @param activeId - The id of the field being dragged (from DragEndEvent.active.id)
   * @param overId - The id of the field being dropped on (from DragEndEvent.over.id)
   */
  const reorderField = useCallback(
    <T extends { id: string; sortOrder?: string | null }>(
      fields: T[],
      activeId: string | number,
      overId: string | number
    ) => {
      if (!entityDefinitionId) return
      if (activeId === overId) return

      const oldIndex = fields.findIndex((f) => f.id === activeId)
      const newIndex = fields.findIndex((f) => f.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const movedField = fields[oldIndex]
      if (!movedField) return

      // Reorder array to find neighbors at new position
      const reordered = arrayMove(fields, oldIndex, newIndex)

      // Find neighbors that have a sortOrder (skip special fields like recordId, createdAt, updatedAt)
      let beforeOrder: string | null = null
      for (let i = newIndex - 1; i >= 0; i--) {
        if (reordered[i]?.sortOrder) {
          beforeOrder = reordered[i].sortOrder!
          break
        }
      }

      let afterOrder: string | null = null
      for (let i = newIndex + 1; i < reordered.length; i++) {
        if (reordered[i]?.sortOrder) {
          afterOrder = reordered[i].sortOrder!
          break
        }
      }

      const newSortOrder = generateKeyBetween(beforeOrder, afterOrder)

      updateField.mutate({
        resourceFieldId: toResourceFieldId(entityDefinitionId, toFieldId(movedField.id)),
        sortOrder: newSortOrder,
      })
    },
    [entityDefinitionId, updateField]
  )

  return {
    isPending: createField.isPending || updateField.isPending || deleteField.isPending,
    create: createField,
    update: updateField,
    destroy: deleteField,
    reorderField,
  }
}

// =============================================================================
// SELECT OPTION MUTATIONS HOOK
// =============================================================================

/** Changes that can be applied to a select option */
export interface SelectOptionChanges {
  label?: string
  color?: string
  targetTimeInStatus?: TargetTimeInStatus | null
  celebration?: boolean
}

/**
 * Hook for mutating select field options.
 * Works for SINGLE_SELECT, MULTI_SELECT, TAGS fields.
 * Provides create, update, delete, and reorder operations with optimistic updates.
 *
 * @param resourceFieldId - The field to mutate options on
 *
 * @example
 * // Kanban column mutations
 * const { updateOption, createOption, deleteOption } = useFieldSelectOptionMutations(resourceFieldId)
 * updateOption(columnId, { label: 'New Label' })
 *
 * // Tag mutations
 * const { createOption } = useFieldSelectOptionMutations(tagFieldId)
 * createOption({ label: 'New Tag', color: 'blue' })
 */
export function useFieldSelectOptionMutations(resourceFieldId: ResourceFieldId | undefined) {
  // Derive entityDefinitionId from resourceFieldId
  const entityDefinitionId = resourceFieldId
    ? parseResourceFieldId(resourceFieldId).entityDefinitionId
    : undefined

  const { update: updateField } = useCustomFieldMutations({ entityDefinitionId })

  // Subscribe to field to get current options
  const field = useField(resourceFieldId)

  /** Get current options from field */
  const getCurrentOptions = useCallback((): SelectOption[] => {
    return (field?.options?.options as SelectOption[]) ?? []
  }, [field?.options?.options])

  /** Update an existing option */
  const updateOption = useCallback(
    (optionValue: string, changes: SelectOptionChanges) => {
      if (!resourceFieldId) return

      const currentOptions = getCurrentOptions()
      const updatedOptions = currentOptions.map((opt) => {
        if (opt.value !== optionValue) return opt
        return {
          ...opt,
          ...(changes.label !== undefined && { label: changes.label }),
          ...(changes.color !== undefined && { color: changes.color }),
          ...(changes.targetTimeInStatus !== undefined && {
            targetTimeInStatus: changes.targetTimeInStatus ?? undefined,
          }),
          ...(changes.celebration !== undefined && { celebration: changes.celebration }),
        }
      })

      updateField.mutate({ resourceFieldId, options: updatedOptions })
    },
    [resourceFieldId, getCurrentOptions, updateField]
  )

  /** Create a new option */
  const createOption = useCallback(
    (data: Omit<SelectOption, 'value'> & { value?: string }) => {
      if (!resourceFieldId) return

      const currentOptions = getCurrentOptions()
      const newOption: SelectOption = {
        value: data.value ?? data.label, // Use label as value if not provided
        label: data.label,
        color: data.color,
        targetTimeInStatus: data.targetTimeInStatus,
        celebration: data.celebration,
      }

      updateField.mutate({ resourceFieldId, options: [...currentOptions, newOption] })
    },
    [resourceFieldId, getCurrentOptions, updateField]
  )

  /** Delete an option */
  const deleteOption = useCallback(
    (optionValue: string) => {
      if (!resourceFieldId) return

      const currentOptions = getCurrentOptions()
      updateField.mutate({
        resourceFieldId,
        options: currentOptions.filter((opt) => opt.value !== optionValue),
      })
    },
    [resourceFieldId, getCurrentOptions, updateField]
  )

  /** Reorder options */
  const reorderOptions = useCallback(
    (newOrder: string[]) => {
      if (!resourceFieldId) return

      const currentOptions = getCurrentOptions()
      const optionMap = new Map(currentOptions.map((o) => [o.value, o]))

      // Build reordered array
      const reordered = newOrder
        .map((value) => optionMap.get(value))
        .filter(Boolean) as SelectOption[]

      // Append any options not in newOrder
      const orderedSet = new Set(newOrder)
      const remaining = currentOptions.filter((o) => !orderedSet.has(o.value))

      updateField.mutate({ resourceFieldId, options: [...reordered, ...remaining] })
    },
    [resourceFieldId, getCurrentOptions, updateField]
  )

  return {
    updateOption,
    createOption,
    deleteOption,
    reorderOptions,
    isPending: updateField.isPending,
  }
}
