// apps/web/src/components/fields/entity-fields.tsx
'use client'

import React, { useState, useCallback, useRef, useMemo } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { getSmartSortPositions } from '@auxx/utils'
import { FieldNavigationProvider } from './field-navigation-context'
import { ModelTypes, type ModelType } from '@auxx/types/custom-field'
import { useCustomField } from '~/components/custom-fields/hooks/use-custom-field'
import { useConfirm } from '~/hooks/use-confirm'
import { EntityFieldsContent } from './entity-fields-content'
import { useResource, useRecord, useRecordHydration } from '~/components/resources'
import type { ResourceField } from '@auxx/lib/resources/client'
import { sortFieldsForDisplay, isSystemResourceId } from '@auxx/lib/resources/client'
import {
  type ResourceType,
  type StoredFieldValue,
} from '~/components/resources/store/custom-field-value-store'
import type { StoreConfig } from './property-provider'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'

/**
 * Props for EntityFields component
 */
interface EntityFieldsProps {
  /** Entity definition ID - system resource (e.g. 'contact') or custom entity UUID */
  entityDefinitionId: string
  /** The specific instance ID within that entity type */
  entityInstanceId: string
  /** Pre-loaded custom fields (avoids refetch for entity instances) */
  preloadedFields?: any[]
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
  /** Additional className for the outer container */
  className?: string
}

/**
 * Generic component for rendering and managing entity fields (both built-in and custom)
 * Uses unified field definitions from ResourceRegistryService.
 *
 * MIGRATED: Fields are now sourced from Resource.fields (system + custom combined)
 * with proper isSystem, showInPanel, and systemSortOrder properties.
 */
function EntityFields({
  entityDefinitionId,
  entityInstanceId,
  preloadedFields,
  onMutationSuccess,
  className,
}: EntityFieldsProps) {
  // Derive modelType from entityDefinitionId
  // System resources use their ID as modelType, custom entities use 'entity'
  const isSystemResource = isSystemResourceId(entityDefinitionId)
  const modelType: ModelType = isSystemResource ? (entityDefinitionId as ModelType) : 'entity'

  // Determine resource type for store
  const resourceType: ResourceType = isSystemResource
    ? (entityDefinitionId as ResourceType)
    : 'entity'

  // State management
  // const [fieldValues] = useState<Record<string, { valueId?: string; value: StoredFieldValue }>>({})
  const closeHandlersRef = useRef<Record<string, () => void>>({})
  const openProviderIdRef = useRef<string | null>(null)

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<any | null>(null)
  // Optimistic reorder state - only used during drag operations
  const [optimisticOrder, setOptimisticOrder] = useState<ResourceField[] | null>(null)

  // Use custom field hook for creating/updating/deleting fields (skip fetching - fields come from resource)
  const { create, update, isPending, destroy } = useCustomField({
    entityDefinitionId,
    skipFetch: true,
  })

  // Confirm dialog for delete
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // ─────────────────────────────────────────────────────────────────
  // RESOURCE & RECORD DATA
  // ─────────────────────────────────────────────────────────────────

  // Get resource from ResourceProvider (single source of truth)
  const { resource, isLoading: resourceLoading } = useResource(entityDefinitionId)

  // Fetch record data (uses cache from list view, fetches if needed)
  const { record, isLoading: recordLoading } = useRecord({
    entityDefinitionId,
    entityInstanceId,
    enabled: !!entityInstanceId && !!resource,
  })

  // Hydrate field values into the store when data changes
  useRecordHydration({
    resource,
    recordId: entityInstanceId,
    recordData: record as Record<string, unknown> | undefined,
    enabled: !!record && !!resource,
  })

  // ─────────────────────────────────────────────────────────────────
  // FIELD PROCESSING (unified system + custom)
  // ─────────────────────────────────────────────────────────────────

  // Get unified field list sorted for display
  const displayFields = useMemo(() => {
    if (!resource?.fields) return []
    return sortFieldsForDisplay(resource.fields)
  }, [resource?.fields])

  // Enrich fields with dynamic options
  const { fields: enrichedFields, isLoading: optionsLoading } =
    useDynamicFieldOptions(displayFields)

  // Use optimistic order during drag, otherwise use enriched fields directly
  // This avoids the infinite loop caused by useEffect + setState
  const sortedFields = optimisticOrder ?? enrichedFields

  // Note: Field value mutations are handled internally by PropertyProvider via storeConfig

  // ─────────────────────────────────────────────────────────────────
  // PROVIDER COORDINATION (for popover management)
  // ─────────────────────────────────────────────────────────────────

  const registerProviderClose = useCallback((providerId: string, closeFn: () => void) => {
    closeHandlersRef.current[providerId] = closeFn
  }, [])

  const unregisterProviderClose = useCallback((providerId: string) => {
    delete closeHandlersRef.current[providerId]
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  const handleProviderOpenChange = useCallback((providerId: string, nextOpen: boolean) => {
    if (nextOpen) {
      if (openProviderIdRef.current === providerId) return
      const activeId = openProviderIdRef.current
      if (activeId && activeId !== providerId) {
        closeHandlersRef.current[activeId]?.()
      }
      openProviderIdRef.current = providerId
      return
    }
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────
  // DRAG & DROP
  // ─────────────────────────────────────────────────────────────────

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Only allow reordering of custom fields
    const customFields = sortedFields.filter((f) => !f.isSystem)
    const oldIndex = customFields.findIndex((item) => item.key === active.id)
    const newIndex = customFields.findIndex((item) => item.key === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = getSmartSortPositions(customFields, oldIndex, newIndex)

    // Set optimistic order for immediate UI feedback
    const systemFields = sortedFields.filter((f) => f.isSystem)
    const reorderedCustom = arrayMove(customFields, oldIndex, newIndex)
    setOptimisticOrder([...systemFields, ...reorderedCustom])

    // Persist to server, then clear optimistic order (server data will be used)
    try {
      await Promise.all(newOrder.map(({ id, sortOrder }) => update.mutateAsync({ id, sortOrder })))
    } finally {
      // Clear optimistic order - the refetch will update enrichedFields
      setOptimisticOrder(null)
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // FIELD MANAGEMENT (create/edit/delete custom fields)
  // ─────────────────────────────────────────────────────────────────

  const handleAddField = () => {
    setEditingField(null)
    setDialogOpen(true)
  }

  const handleEditField = (_fieldId: string, field: any) => {
    setEditingField(field)
    setDialogOpen(true)
  }

  const handleSaveField = async (fieldData: any) => {
    if (editingField) {
      await update.mutateAsync({ ...fieldData, id: editingField.id })
    } else {
      // modelType is derived from entityDefinitionId on server
      await create.mutateAsync({
        ...fieldData,
        entityDefinitionId,
      })
    }

    setEditingField(null)

    if (preloadedFields) {
      onMutationSuccess?.()
    }
  }

  const handleDeleteField = async (fieldId: string, fieldName: string) => {
    const confirmed = await confirmDelete({
      title: 'Delete custom field?',
      description: `Are you sure you want to delete "${fieldName}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await destroy.mutateAsync({ id: fieldId })
      if (preloadedFields) {
        onMutationSuccess?.()
      }
    }
  }

  /**
   * Determine if a field is sortable (only custom fields)
   */
  const isSortable = (field: ResourceField) => {
    return !field.isSystem && field.capabilities.updatable !== false
  }

  // ─────────────────────────────────────────────────────────────────
  // STORE CONFIG
  // ─────────────────────────────────────────────────────────────────

  const storeConfig: StoreConfig | undefined = useMemo(() => {
    if (!entityInstanceId) return undefined
    return {
      resourceType,
      resourceId: entityInstanceId,
      entityDefId: isSystemResource ? undefined : entityDefinitionId,
      modelType,
    }
  }, [resourceType, entityInstanceId, entityDefinitionId, isSystemResource, modelType])

  const isLoading = resourceLoading || optionsLoading || recordLoading

  // Don't render until we have store config (requires entityId)
  if (!storeConfig) {
    return null
  }

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
        currentResourceId={entityDefinitionId}
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        fields={sortedFields}
        // fieldValues={fieldValues}
        isLoading={isLoading}
        isSortable={isSortable}
        handleDeleteField={handleDeleteField}
        handleEditField={handleEditField}
        handleAddField={handleAddField}
        handleProviderOpenChange={handleProviderOpenChange}
        registerProviderClose={registerProviderClose}
        unregisterProviderClose={unregisterProviderClose}
        ConfirmDeleteDialog={ConfirmDeleteDialog}
        storeConfig={storeConfig}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
