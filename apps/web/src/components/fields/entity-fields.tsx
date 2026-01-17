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
import { generateKeyBetween } from '@auxx/utils'
import { FieldNavigationProvider } from './field-navigation-context'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useConfirm } from '~/hooks/use-confirm'
import { EntityFieldsContent } from './entity-fields-content'
import { useResource, useRecord, useRecordHydration } from '~/components/resources'
import {
  parseResourceId,
  sortFieldsForDisplay,
  type ResourceField,
  type ResourceId,
} from '@auxx/lib/resources/client'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'

/**
 * Props for EntityFields component
 */
interface EntityFieldsProps {
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
  /** Callback after successful mutation (e.g., to refetch parent data) */
  onMutationSuccess?: () => void
  /** Additional className for the outer container */
  className?: string
  /** Whether fields can be edited (default: true) */
  canEdit?: boolean
  /** Whether all fields are read-only (default: false) */
  readOnly?: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle?: boolean
  /** Array of field keys to exclude from display (e.g., ['createdAt', 'updatedAt']) */
  excludeFields?: string[]
}

/**
 * Generic component for rendering and managing entity fields (both built-in and custom)
 * Uses unified field definitions from ResourceRegistryService.
 *
 * MIGRATED: Fields are now sourced from Resource.fields (system + custom combined)
 * with proper isSystem, showInPanel, and systemSortOrder properties.
 */
function EntityFields({
  resourceId,
  onMutationSuccess,
  className,
  canEdit = true,
  readOnly = false,
  showTitle = true,
  excludeFields,
}: EntityFieldsProps) {
  // Parse resourceId to get components
  const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)

  // State management
  const closeHandlersRef = useRef<Record<string, () => void>>({})
  const openProviderIdRef = useRef<string | null>(null)

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<any | null>(null)
  // Local optimistic order for immediate UI feedback during reorder
  const [optimisticOrder, setOptimisticOrder] = useState<ResourceField[] | null>(null)

  // Use custom field mutations hook for creating/updating/deleting fields (fields come from resource)
  const { create, update, isPending, destroy } = useCustomFieldMutations({
    entityDefinitionId,
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
    resourceId,
    enabled: !!resource,
  })

  // Hydrate field values into the store when data changes
  useRecordHydration({
    resource,
    resourceId,
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

  // Use optimistic order for immediate UI feedback, fall back to enriched fields
  const sortedFields = optimisticOrder ?? enrichedFields

  // Apply field exclusion filter
  const filteredFields = useMemo(() => {
    if (!excludeFields || excludeFields.length === 0) {
      return sortedFields
    }

    return sortedFields.filter((field) => !excludeFields.includes(field.key))
  }, [sortedFields, excludeFields])

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Only allow reordering of custom fields from FILTERED list
    const customFields = filteredFields.filter((f) => !f.isSystem)
    const oldIndex = customFields.findIndex((item) => item.id === active.id)
    const newIndex = customFields.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const movedField = customFields[oldIndex]
    if (!movedField) return

    // Reorder to find neighbors at new position
    const reorderedCustom = arrayMove(customFields, oldIndex, newIndex)
    const beforeField = newIndex > 0 ? reorderedCustom[newIndex - 1] : null
    const afterField = newIndex < reorderedCustom.length - 1 ? reorderedCustom[newIndex + 1] : null

    // Generate ONE key between neighbors
    const newSortOrder = generateKeyBetween(
      beforeField?.sortOrder ?? null,
      afterField?.sortOrder ?? null
    )

    // Set optimistic order immediately for smooth UI
    const systemFields = filteredFields.filter((f) => f.isSystem)
    setOptimisticOrder([...systemFields, ...reorderedCustom])

    // Update only the moved field, clear optimistic state when done
    update.mutate(
      { id: movedField.id, sortOrder: newSortOrder },
      { onSettled: () => setOptimisticOrder(null) }
    )
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
      // entityDefinitionId is now included by CustomFieldDialog
      await create.mutateAsync(fieldData)
    }

    setEditingField(null)

    onMutationSuccess?.()
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
      onMutationSuccess?.()
    }
  }

  /**
   * Determine if a field is sortable (only custom fields)
   */
  const isSortable = (field: ResourceField) => {
    return !field.isSystem && field.capabilities.updatable !== false
  }

  const isLoading = resourceLoading || optionsLoading || recordLoading

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
        sensors={sensors}
        handleDragEnd={handleDragEnd}
        fields={filteredFields}
        isLoading={isLoading}
        isSortable={isSortable}
        handleDeleteField={handleDeleteField}
        handleEditField={handleEditField}
        handleAddField={handleAddField}
        handleProviderOpenChange={handleProviderOpenChange}
        registerProviderClose={registerProviderClose}
        unregisterProviderClose={unregisterProviderClose}
        ConfirmDeleteDialog={ConfirmDeleteDialog}
        resourceId={resourceId}
        canEdit={canEdit}
        readOnly={readOnly}
        showTitle={showTitle}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
