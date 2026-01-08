// apps/web/src/components/fields/entity-fields.tsx
'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Calendar } from 'lucide-react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { getSmartSortPositions } from '@auxx/utils'
import { api } from '~/trpc/react'
import { useFieldValidation } from '../contacts/validation/use-field-validation'
import { toastError } from '@auxx/ui/components/toast'
import { FieldNavigationProvider } from './field-navigation-context'
import { ModelTypes, type ModelType } from '@auxx/types/custom-field'
import { modelConfigs } from './configs/model-field-configs'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { useConfirm } from '~/hooks/use-confirm'
import { EntityFieldsContent } from './entity-fields-content'
import { useAllResources } from '~/components/resources'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import {
  useCustomFieldValueStore,
  type ResourceType,
  type StoredFieldValue,
} from '~/stores/custom-field-value-store'
import type { StoreConfig } from './property-provider'
import { formatToTypedInput } from '@auxx/lib/field-values/client'

/**
 * Props for EntityFields component
 */
interface EntityFieldsProps {
  modelType: ModelType
  entityId: string
  /** For entity instances: indicates entity instance mode (skips built-in fields) */
  entityDefinitionId?: string
  /** Pre-loaded custom fields (avoids refetch for entity instances) */
  preloadedFields?: any[]
  /** Entity instance created timestamp (for entity instances) - can be Date (SuperJSON) or string */
  createdAt?: string | Date
  /** Entity instance updated timestamp (for entity instances) - can be Date (SuperJSON) or string */
  updatedAt?: string | Date
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
  /** Additional className for the outer container (e.g., for margins) */
  className?: string
}

/**
 * Generic component for rendering and managing entity fields (both built-in and custom)
 * Supports Contact, Ticket, Thread/Conversation, Company models, and custom Entity instances
 */
function EntityFields({
  modelType,
  entityId,
  entityDefinitionId,
  preloadedFields,
  createdAt,
  updatedAt,
  onMutationSuccess,
  className,
}: EntityFieldsProps) {
  const values = undefined
  // Detect entity instance mode (no built-in fields, use preloaded data)
  const isEntityInstance = !!entityDefinitionId

  // Get config only for non-entity models (entity instances have no built-in fields)
  const config = isEntityInstance ? null : modelConfigs[modelType]

  // Determine the modelType to use for mutations
  const mutationModelType = isEntityInstance ? ModelTypes.ENTITY : modelType

  // Determine resource type for store
  const resourceType: ResourceType = isEntityInstance ? 'entity' : (modelType as ResourceType)

  // Get store actions for hydration
  const setValues = useCustomFieldValueStore((s) => s.setValues)

  // State management - stores TypedFieldValue with optional valueId for linking attachments
  const [fieldValues, setFieldValues] = useState<
    Record<string, { valueId?: string; value: StoredFieldValue }>
  >({})
  const [builtInValues, setBuiltInValues] = useState<Record<string, StoredFieldValue>>({})
  const [isValid, setIsValid] = useState(true)
  const closeHandlersRef = useRef<Record<string, () => void>>({})
  const openProviderIdRef = useRef<string | null>(null)

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<any | null>(null)
  const [sortedCustomFields, setSortedCustomFields] = useState<any[]>([])

  const { validateField } = useFieldValidation()

  // Use custom field hook for creating/updating/deleting fields
  const { create, update, isPending, destroy } = useCustomField({
    modelType: mutationModelType,
    entityDefinitionId,
  })

  // Confirm dialog for delete
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Dynamic entity query based on model type (only for non-entity instances)
  // Note: Type safety is partially lost here, but functionality is preserved
  const { data: entity, isLoading: entityLoading } = (api as any)[
    config?.queries.getById.split('.')[0] ?? 'entityInstance'
  ][config?.queries.getById.split('.')[1] ?? 'getById'].useQuery(
    { id: entityId },
    { enabled: !!entityId && !isEntityInstance }
  )

  // Load dynamic options for fields that need them (only for non-entity instances)
  const { fields: builtInFieldsWithOptions, isLoading: optionsLoading } = useDynamicFieldOptions(
    config?.builtInFields ?? [],
    modelType
  )

  // Get fields from ResourceProvider (single source of truth)
  const { resources } = useAllResources()
  const fields = useMemo(() => {
    let resource
    if (isEntityInstance && entityDefinitionId) {
      // Custom entity: look up by entityDefinitionId
      resource = resources.find(
        (r) => r.type === 'custom' && r.entityDefinitionId === entityDefinitionId
      )
    } else {
      // System resource: look up by modelType (contact, ticket, etc.)
      resource = resources.find((r) => r.id === modelType)
    }

    if (!resource) return null

    // Filter to only custom fields (those with id set) and transform to expected format
    return resource.fields
      .filter((f): f is ResourceField & { id: string } => !!f.id)
      .map((field) => ({
        ...field,
        type: field.fieldType || mapBaseTypeToFieldType(field.type),
        name: field.name ?? field.label,
      }))
  }, [resources, modelType, isEntityInstance, entityDefinitionId, preloadedFields])

  // Use preloaded values for entity instances
  // const values = preloadedValues

  // Unified mutation for both built-in and custom fields
  const setValueMutation = api.fieldValue.set.useMutation({
    onError: (error) => {
      toastError({ title: 'Error updating field', description: error.message })
    },
  })

  // Populate built-in field values from entity data (skip for entity instances)
  useEffect(() => {
    if (isEntityInstance || !entity || !config) return

    const builtInValueMap: Record<string, StoredFieldValue> = {}

    config.builtInFields.forEach((field) => {
      let rawValue = (entity as any)[field.id]

      // Handle compound fields (name)
      if (field.id === 'name' && modelType === ModelTypes.CONTACT) {
        rawValue = {
          firstName: (entity as any).firstName || '',
          lastName: (entity as any).lastName || '',
        }
      }
      // Handle array relationship fields (extract IDs from related objects)
      else if (Array.isArray(rawValue) && field.dynamicOptions) {
        rawValue = rawValue.map((item: any) => {
          // Try to extract ID from nested relation first
          // e.g., customerGroups has nested customerGroup object
          const singularKey = field.id.slice(0, -1) // 'customerGroups' -> 'customerGroup'
          return item[singularKey]?.id || item.id
        })
      }

      // Convert raw value to TypedFieldValue using centralized formatter
      const typedValue = formatToTypedInput(rawValue, field.type, {
        selectOptions: field.options?.options,
      })
      builtInValueMap[field.id] = typedValue as StoredFieldValue
    })

    setBuiltInValues(builtInValueMap)
  }, [entity, config, modelType, isEntityInstance])

  // Populate custom field values (handles both preloaded and fetched values)
  // Also hydrate the global store for bi-directional sync with table

  // Sync sortedCustomFields with fetched fields
  useEffect(() => {
    if (fields) {
      const sorted = [...fields]
        .filter((f: any) => f.active !== false)
        .sort((a: any, b: any) => (a.sortOrder ?? '').localeCompare(b.sortOrder ?? ''))
      setSortedCustomFields(sorted)
    }
  }, [fields])

  // Validate all fields and determine if form is valid
  useEffect(() => {
    if (!fields) return

    const errorMap: Record<string, string | null> = {}
    let formValid = true

    fields.forEach((field: any) => {
      const fieldEntry = fieldValues[field.id]
      // Extract TypedFieldValue from the new structure { valueId, value: TypedFieldValue }
      const typedValue = fieldEntry?.value ?? null

      const result = validateField(field, typedValue)
      errorMap[field.id] = result.valid ? null : result.error

      if (!result.valid) {
        formValid = false
      }
    })

    setIsValid(formValid)
  }, [fields, fieldValues, validateField])

  /**
   * Create a mutation function for a specific custom field
   * Receives raw value from PropertyProvider, mutation returns TypedFieldValue
   */
  const handleFieldMutate = useCallback(
    (fieldId: string) => async (rawValue: any) => {
      if (!entityId) return

      try {
        // Call mutation - receives raw value, returns { id, value: TypedFieldValue }
        const result = await setValueMutation.mutateAsync({
          resourceId: entityId,
          fieldId,
          value: rawValue,
          modelType: mutationModelType,
        })

        // Extract returned data - mutation now returns TypedFieldValue directly
        const resultId = (result as { id?: string })?.id
        const typedValue = (result as { value?: StoredFieldValue })?.value ?? null

        // Update local state with TypedFieldValue
        setFieldValues((prev) => ({
          ...prev,
          [fieldId]: {
            valueId: resultId || prev[fieldId]?.valueId,
            value: typedValue,
          },
        }))

        return resultId ? { id: resultId } : undefined
      } catch (error) {
        throw error
      }
    },
    [entityId, setValueMutation, mutationModelType]
  )

  /**
   * Registers a provider-specific close handler for future forced closes.
   */
  const registerProviderClose = useCallback((providerId: string, closeFn: () => void) => {
    closeHandlersRef.current[providerId] = closeFn
  }, [])

  /**
   * Removes a provider close handler when it unmounts.
   */
  const unregisterProviderClose = useCallback((providerId: string) => {
    delete closeHandlersRef.current[providerId]
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  /**
   * Ensures only one popover is open at a time by closing any previously opened provider.
   */
  const handleProviderOpenChange = useCallback((providerId: string, nextOpen: boolean) => {
    if (nextOpen) {
      if (openProviderIdRef.current === providerId) return
      const activeId = openProviderIdRef.current
      if (activeId && activeId !== providerId) {
        const closeFn = closeHandlersRef.current[activeId]
        if (closeFn) {
          closeFn()
        }
      }
      openProviderIdRef.current = providerId
      return
    }
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  /**
   * Create a mutation function for built-in entity fields
   * Receives raw value from PropertyProvider, sends to mutation
   */
  const handleBuiltInFieldMutate = useCallback(
    (fieldId: string) => async (rawValue: any) => {
      if (!entityId) return

      try {
        // PropertyProvider now passes raw values directly (no legacy wrapping)
        await setValueMutation.mutateAsync({
          resourceId: entityId,
          fieldId,
          value: rawValue,
          modelType: mutationModelType,
        })
      } catch (error) {
        throw error
      }
    },
    [entityId, setValueMutation, mutationModelType]
  )

  /**
   * Handle drag end for reordering custom fields
   */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      let newOrder: { id: string; sortOrder: string }[] = []
      setSortedCustomFields((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        const newItems = arrayMove(items, oldIndex, newIndex)
        newOrder = getSmartSortPositions(items, oldIndex, newIndex)
        return newItems
      })

      // Update each affected field's sortOrder using generic update mutation
      await Promise.all(newOrder.map(({ id, sortOrder }) => update.mutateAsync({ id, sortOrder })))
    }
  }

  /**
   * Handle adding a new custom field
   */
  const handleAddField = () => {
    setEditingField(null)
    setDialogOpen(true)
  }

  /**
   * Handle editing an existing custom field
   */
  const handleEditField = (_fieldId: string, field: any) => {
    setEditingField(field)
    setDialogOpen(true)
  }

  /**
   * Handle saving a custom field (create or update)
   */
  const handleSaveField = async (fieldData: any) => {
    if (editingField) {
      // Update existing field
      await update.mutateAsync({ ...fieldData, id: editingField.id })
    } else {
      // Create new field
      const values = {
        ...fieldData,
        modelType: mutationModelType,
        entityDefinitionId: entityDefinitionId || undefined,
      }
      await create.mutateAsync(values)
    }

    setEditingField(null)

    // Refetch fields after save
    // For entity instances with preloadedFields, the query is disabled so refetchFields won't work
    // Instead, call onMutationSuccess to trigger parent refetch
    if (preloadedFields) {
      onMutationSuccess?.()
    }
  }

  /**
   * Handle deleting a custom field (with confirmation)
   */
  const handleDeleteField = async (fieldId: string, fieldName: string) => {
    const confirmed = await confirmDelete({
      title: 'Delete custom field?',
      description: `Are you sure you want to delete "${fieldName}"? This action cannot be undone and any data stored in this field will be lost.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await destroy.mutateAsync({ id: fieldId })

      // Refetch fields after deletion
      if (preloadedFields) {
        onMutationSuccess?.()
      }
    }
  }

  /**
   * Determine if a field is sortable (only custom fields that are not read-only)
   */
  const isSortable = (field: any, isBuiltIn: boolean) => {
    if (isBuiltIn) return false
    if (field.readOnly) return false
    return true
  }

  // For entity instances, determine loading state differently
  // const isLoadingValues = isEntityInstance ? false : valuesLoading
  const isLoadingValues = false //isEntityInstance ? false : valuesLoading

  // System timestamp fields for entity instances (read-only)
  // Convert Date objects or date strings to ISO format for proper parsing
  const formatDateValue = (dateValue: string | Date | undefined): string | undefined => {
    if (!dateValue) return undefined
    if (dateValue instanceof Date) return dateValue.toISOString()
    // Handle string dates - convert to ISO format (replace space with T if needed)
    const date = new Date(dateValue)
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
    return dateValue
  }

  const systemFields = isEntityInstance
    ? [
        ...(createdAt
          ? [
              {
                id: 'createdAt',
                name: 'Created',
                type: FieldTypeEnum.DATE,
                icon: Calendar,
                readOnly: true,
                value: formatDateValue(createdAt),
              },
            ]
          : []),
        ...(updatedAt
          ? [
              {
                id: 'updatedAt',
                name: 'Last updated',
                type: FieldTypeEnum.DATE,
                icon: Calendar,
                readOnly: true,
                value: formatDateValue(updatedAt),
              },
            ]
          : []),
      ]
    : []

  // Build the resource ID for relationship field editor
  const currentResourceId = isEntityInstance ? entityDefinitionId : modelType

  // Create storeConfig for PropertyProvider (bi-directional sync with table)
  const storeConfig: StoreConfig | undefined = useMemo(() => {
    if (!entityId) return undefined
    return {
      resourceType,
      resourceId: entityId,
      entityDefId: entityDefinitionId,
      modelType: mutationModelType,
    }
  }, [resourceType, entityId, entityDefinitionId, mutationModelType])

  return (
    <FieldNavigationProvider>
      <EntityFieldsContent
        className={className}
        isEditMode={isEditMode}
        setIsEditMode={setIsEditMode}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        editingField={editingField}
        handleSaveField={handleSaveField}
        isPending={isPending}
        currentResourceId={currentResourceId}
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        sortedCustomFields={sortedCustomFields}
        isEntityInstance={isEntityInstance}
        builtInFieldsWithOptions={builtInFieldsWithOptions}
        builtInValues={builtInValues}
        handleBuiltInFieldMutate={handleBuiltInFieldMutate}
        entityLoading={entityLoading}
        optionsLoading={optionsLoading}
        handleProviderOpenChange={handleProviderOpenChange}
        registerProviderClose={registerProviderClose}
        unregisterProviderClose={unregisterProviderClose}
        fieldValues={fieldValues}
        handleFieldMutate={handleFieldMutate}
        isLoadingValues={isLoadingValues}
        isSortable={isSortable}
        handleDeleteField={handleDeleteField}
        handleEditField={handleEditField}
        systemFields={systemFields}
        handleAddField={handleAddField}
        ConfirmDeleteDialog={ConfirmDeleteDialog}
        storeConfig={storeConfig}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
