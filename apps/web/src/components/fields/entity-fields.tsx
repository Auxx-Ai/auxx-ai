// apps/web/src/components/fields/entity-fields.tsx
'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Calendar, Pencil, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { getSmartSortPositions } from '@auxx/utils'
import { api } from '~/trpc/react'
import { useFieldValidation } from '../contacts/validation/use-field-validation'
import { toastError } from '@auxx/ui/components/toast'
import { FieldNavigationProvider, useFieldNavigation } from './field-navigation-context'
import { ModelTypes, type ModelType } from '@auxx/types/custom-field'
import { modelConfigs, type EntityModelConfig } from './configs/model-field-configs'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { SortablePropertyRow } from './sortable-property-row'
import { AddFieldRow } from './add-field-row'
import { cn } from '@auxx/ui/lib/utils'
import { useConfirm } from '~/hooks/use-confirm'
import { useAllResources } from '~/components/resources'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import {
  useCustomFieldValueStore,
  buildValueKey,
  type ResourceType,
  type StoredFieldValue,
} from '~/stores/custom-field-value-store'
import type { StoreConfig } from './property-provider'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { convertToTypedInput } from '@auxx/lib/field-values/client'

/**
 * Transform ResourceField to CustomField format for EntityFields compatibility
 */
function transformResourceFieldForEntityFields(
  field: ResourceField & { id: string },
  index: number
): any {
  // Use preserved fieldType from ResourceField if available, otherwise fallback to mapping BaseType
  const fieldType = field.fieldType || mapBaseTypeToFieldType(field.type)

  // Build options object from ResourceField properties
  const options: Record<string, unknown> = {}

  // Handle enum values for select fields
  if (field.enumValues && field.enumValues.length > 0) {
    options.options = field.enumValues.map((e) => ({
      label: e.label,
      value: e.dbValue,
    }))
  }

  // Handle relationship configuration
  if (field.relationship) {
    // Map cardinality to relationshipType
    let relationshipType: 'belongs_to' | 'has_one' | 'has_many' = 'belongs_to'
    if (field.relationship.cardinality === 'one-to-many') {
      relationshipType = 'has_many'
    } else if (field.relationship.cardinality === 'one-to-one') {
      relationshipType = 'has_one'
    }

    options.relationship = {
      // Use the preserved relatedEntityDefinitionId from ResourceField
      // For custom entities: UUID (e.g., "xw53y13fbov3dhdenzqlft2u")
      // For system resources: undefined (use relatedModelType instead)
      relatedEntityDefinitionId: field.relationship.relatedEntityDefinitionId,
      // Use the preserved relatedModelType from ResourceField
      // For system resources: model type (e.g., "contact", "ticket")
      // For custom entities: undefined (use relatedEntityDefinitionId instead)
      relatedModelType: field.relationship.relatedModelType,
      // Add relationshipType for single/multi select behavior
      relationshipType,
    }
  }

  return {
    id: field.id,
    name: field.label,
    type: fieldType,
    options: Object.keys(options).length > 0 ? options : undefined,
    position: index,
    active: true,
    required: field.capabilities?.required,
    description: field.description,
    defaultValue: field.defaultValue,
  }
}

/** Pre-loaded field value from entity instance */
interface PreloadedFieldValue {
  id: string
  fieldId: string
  value: unknown
}

/**
 * Props for EntityFields component
 */
interface EntityFieldsProps {
  modelType: ModelType
  entityId: string
  /** For entity instances: indicates entity instance mode (skips built-in fields) */
  entityDefinitionId?: string
  /** Pre-loaded values from table row (avoids refetch for entity instances) */
  preloadedValues?: PreloadedFieldValue[]
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
  preloadedValues,
  preloadedFields,
  createdAt,
  updatedAt,
  onMutationSuccess,
  className,
}: EntityFieldsProps) {
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
  const [errors, setErrors] = useState<Record<string, string | null>>({})
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
  const {
    data: entity,
    refetch: refetchEntity,
    isLoading: entityLoading,
  } = (api as any)[config?.queries.getById.split('.')[0] ?? 'entityInstance'][
    config?.queries.getById.split('.')[1] ?? 'getById'
  ].useQuery({ id: entityId }, { enabled: !!entityId && !isEntityInstance })

  // Load dynamic options for fields that need them (only for non-entity instances)
  const { fields: builtInFieldsWithOptions, isLoading: optionsLoading } = useDynamicFieldOptions(
    config?.builtInFields ?? [],
    modelType
  )

  // Get fields from ResourceProvider (single source of truth)
  const { resources } = useAllResources()
  const resourceFields = useMemo(() => {
    if (preloadedFields) return null // Explicit preload takes precedence

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
      .map((field, index) => transformResourceFieldForEntityFields(field, index))
  }, [resources, modelType, isEntityInstance, entityDefinitionId, preloadedFields])

  // Use preloaded fields first, then ResourceProvider fields (single source of truth)
  const fields = preloadedFields ?? resourceFields

  // Fetch only values (field definitions come from useAllResources via resourceFields)
  // const {
  //   data: fetchedValues,
  //   refetch: refetchValues,
  //   isLoading: valuesLoading,
  // } = api.fieldValue.getValues.useQuery(
  //   { entityId: entityId || '', fieldIds: fields?.map((f: any) => f.id) ?? [] },
  //   { enabled: !!entityId && !isEntityInstance && !preloadedValues && !!fields }
  // )

  // Use preloaded values for entity instances
  const values = preloadedValues
  // const values = preloadedValues ?? fetchedValues

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

      // Convert raw value to TypedFieldValue
      const typedValue = convertToTypedInput(rawValue, field.type, field.options?.options)
      builtInValueMap[field.id] = typedValue as StoredFieldValue
    })

    setBuiltInValues(builtInValueMap)
  }, [entity, config, modelType, isEntityInstance])

  // Populate custom field values (handles both preloaded and fetched values)
  // Also hydrate the global store for bi-directional sync with table
  useEffect(() => {
    if (values && entityId) {
      const valueMap: Record<string, { valueId?: string; value: StoredFieldValue }> = {}
      const storeEntries: Array<{ key: string; value: StoredFieldValue }> = []

      // Handle both Map (from getValues) and array (from preloadedValues with field metadata)
      const entries = values instanceof Map ? Array.from(values.entries()) : values

      if (values instanceof Map) {
        // Data from getValues() - Map<fieldId, TypedFieldValue>
        entries.forEach(([fieldId, typedValue]: [string, any]) => {
          valueMap[fieldId] = {
            value: typedValue as StoredFieldValue,
          }
          storeEntries.push({
            key: buildValueKey(resourceType, entityId, fieldId, entityDefinitionId),
            value: typedValue as StoredFieldValue,
          })
        })
      } else {
        // Data from preloadedValues - array with field metadata
        entries.forEach((value: any) => {
          const typedValue = value.value as StoredFieldValue

          valueMap[value.fieldId] = {
            valueId: value.id, // CustomFieldValue.id for linking attachments
            value: typedValue, // TypedFieldValue directly
          }
          storeEntries.push({
            key: buildValueKey(resourceType, entityId, value.fieldId, entityDefinitionId),
            value: typedValue,
          })
        })
      }

      setFieldValues(valueMap)

      // Hydrate store with values for bi-directional sync
      if (storeEntries.length > 0) {
        setValues(storeEntries)
      }
    }
  }, [values, entityId, resourceType, entityDefinitionId, setValues])

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
      await Promise.all(
        newOrder.map(({ id, sortOrder }) =>
          update.mutateAsync({ id, sortOrder })
        )
      )
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

/**
 * Inner component that uses the navigation context
 */
interface EntityFieldsContentProps {
  className?: string
  isEditMode: boolean
  setIsEditMode: (value: boolean) => void
  dialogOpen: boolean
  setDialogOpen: (value: boolean) => void
  editingField: any | null
  handleSaveField: (fieldData: any) => Promise<void>
  isPending: boolean
  currentResourceId: string
  sensors: ReturnType<typeof useSensors>
  handleDragEnd: (event: DragEndEvent) => Promise<void>
  sortedCustomFields: any[]
  isEntityInstance: boolean
  builtInFieldsWithOptions: any[]
  builtInValues: Record<string, any>
  handleBuiltInFieldMutate: (fieldId: string) => (value: any) => Promise<void>
  entityLoading: boolean
  optionsLoading: boolean
  handleProviderOpenChange: (providerId: string, nextOpen: boolean) => void
  registerProviderClose: (providerId: string, closeFn: () => void) => void
  unregisterProviderClose: (providerId: string) => void
  fieldValues: Record<string, any>
  handleFieldMutate: (fieldId: string) => (value: any) => Promise<any>
  isLoadingValues: boolean
  isSortable: (field: any, isBuiltIn: boolean) => boolean
  handleDeleteField: (fieldId: string, fieldName: string) => Promise<void>
  handleEditField: (fieldId: string, field: any) => void
  systemFields: any[]
  handleAddField: () => void
  ConfirmDeleteDialog: React.FC
  /** Store configuration for bi-directional sync with table */
  storeConfig?: StoreConfig
}

function EntityFieldsContent({
  className,
  isEditMode,
  setIsEditMode,
  dialogOpen,
  setDialogOpen,
  editingField,
  handleSaveField,
  isPending,
  currentResourceId,
  sensors,
  handleDragEnd,
  sortedCustomFields,
  isEntityInstance,
  builtInFieldsWithOptions,
  builtInValues,
  handleBuiltInFieldMutate,
  entityLoading,
  optionsLoading,
  handleProviderOpenChange,
  registerProviderClose,
  unregisterProviderClose,
  fieldValues,
  handleFieldMutate,
  isLoadingValues,
  isSortable,
  handleDeleteField,
  handleEditField,
  systemFields,
  handleAddField,
  ConfirmDeleteDialog,
  storeConfig,
}: EntityFieldsContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { focusedRowId, moveFocus, openFocusedRow, isPopoverCapturing, registerOpenHandler } =
    useFieldNavigation()

  // Track open functions for each row
  const openHandlersRef = useRef<Map<string, () => void>>(new Map())

  // Register a callback to open a specific row by ID
  const registerRowOpen = useCallback((providerId: string, openFn: () => void) => {
    openHandlersRef.current.set(providerId, openFn)
  }, [])

  // Unregister when row unmounts
  const unregisterRowOpen = useCallback((providerId: string) => {
    openHandlersRef.current.delete(providerId)
  }, [])

  // Register the open handler with navigation context
  useEffect(() => {
    registerOpenHandler((rowId: string) => {
      const openFn = openHandlersRef.current.get(rowId)
      openFn?.()
    })
  }, [registerOpenHandler])

  /**
   * Handle keyboard navigation at container level
   * Arrow keys navigate between rows, Enter opens focused row
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If a popover is capturing keys (Tags, Select, Date), let it handle
      if (isPopoverCapturing) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          moveFocus('down')
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus('up')
          break
        case 'Enter':
          if (focusedRowId) {
            e.preventDefault()
            openFocusedRow()
          }
          break
      }
    },
    [isPopoverCapturing, moveFocus, focusedRowId, openFocusedRow]
  )

  return (
    <>
      {/* Confirm delete dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for creating/editing fields */}
      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingField={editingField}
        onSave={handleSaveField}
        isPending={isPending}
        currentResourceId={currentResourceId}
      />

      {/* Styled card container with keyboard navigation */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'group/entity-card bg-primary-100/50 dark:bg-primary-100 border rounded-2xl relative outline-none focus:outline-none',
          className
        )}>
        <div className="flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col">
          {/* Edit mode header */}
          <div
            className={cn(
              'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
              isEditMode ? 'opacity-100' : 'opacity-0 group-hover/entity-card:opacity-100'
            )}>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsEditMode(!isEditMode)}
              className={cn(
                'cursor-pointer',
                isEditMode
                  ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {isEditMode ? <X /> : <Pencil />}
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}>
            <SortableContext
              items={sortedCustomFields.map((f) => f.id)}
              strategy={verticalListSortingStrategy}>
              {/* Render built-in fields first (only for non-entity instances) */}
              {!isEntityInstance &&
                builtInFieldsWithOptions.map((field, idx) => (
                  <SortablePropertyRow
                    key={`builtin-${field.id}`}
                    id={`builtin-${field.id}`}
                    providerId={`builtin-${field.id}`}
                    field={field}
                    value={builtInValues[field.id]}
                    mutate={handleBuiltInFieldMutate(field.id)}
                    loading={
                      entityLoading ||
                      optionsLoading ||
                      !Object.prototype.hasOwnProperty.call(builtInValues, field.id)
                    }
                    isEditMode={isEditMode}
                    isSortable={false}
                    index={idx}
                    onOpenChange={handleProviderOpenChange}
                    registerClose={registerProviderClose}
                    unregisterClose={unregisterProviderClose}
                    registerOpen={registerRowOpen}
                    unregisterOpen={unregisterRowOpen}
                  />
                ))}

              {/* Then render custom fields (sortable) - with store integration */}
              {sortedCustomFields.map((field: any, idx: number) => (
                <SortablePropertyRow
                  key={field.id}
                  id={field.id}
                  providerId={field.id}
                  field={{ ...field, valueId: fieldValues[field.id]?.valueId }}
                  value={fieldValues[field.id]?.value}
                  mutate={handleFieldMutate(field.id)}
                  loading={isLoadingValues}
                  isEditMode={isEditMode}
                  isSortable={isSortable(field, false)}
                  index={builtInFieldsWithOptions.length + idx}
                  onDelete={handleDeleteField}
                  onEdit={handleEditField}
                  onOpenChange={handleProviderOpenChange}
                  registerClose={registerProviderClose}
                  unregisterClose={unregisterProviderClose}
                  registerOpen={registerRowOpen}
                  unregisterOpen={unregisterRowOpen}
                  storeConfig={storeConfig}
                />
              ))}

              {/* System timestamp fields for entity instances (read-only, non-sortable) */}
              {systemFields.map((field, idx) => (
                <SortablePropertyRow
                  key={`system-${field.id}`}
                  id={`system-${field.id}`}
                  providerId={`system-${field.id}`}
                  field={field}
                  value={field.value ? { type: 'date', value: field.value } : null}
                  mutate={async () => {}}
                  loading={false}
                  isEditMode={isEditMode}
                  isSortable={false}
                  index={builtInFieldsWithOptions.length + sortedCustomFields.length + idx}
                  onOpenChange={handleProviderOpenChange}
                  registerClose={registerProviderClose}
                  unregisterClose={unregisterProviderClose}
                  registerOpen={registerRowOpen}
                  unregisterOpen={unregisterRowOpen}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add Field row - only show in edit mode */}
          {isEditMode && <AddFieldRow onClick={handleAddField} />}
        </div>
      </div>
    </>
  )
}

export default EntityFields
