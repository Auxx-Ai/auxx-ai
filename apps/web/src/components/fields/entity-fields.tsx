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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { FieldNavigationProvider } from './field-navigation-context'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useConfirm } from '~/hooks/use-confirm'
import { EntityFieldsContent } from './entity-fields-content'
import { useResourceFields } from '~/components/resources'
import {
  parseRecordId,
  sortFieldsForDisplay,
  type ResourceField,
  type RecordId,
} from '@auxx/lib/resources/client'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { toResourceFieldId, type ResourceFieldId } from '@auxx/types/field'

/**
 * Props for EntityFields component
 */
interface EntityFieldsProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
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
  recordId,
  onMutationSuccess,
  className,
  canEdit = true,
  readOnly = false,
  showTitle = true,
  excludeFields,
}: EntityFieldsProps) {
  // Parse recordId to get entityDefinitionId
  const { entityDefinitionId } = parseRecordId(recordId)

  // State management
  const closeHandlersRef = useRef<Record<string, () => void>>({})
  const openProviderIdRef = useRef<string | null>(null)

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingResourceFieldId, setEditingResourceFieldId] = useState<ResourceFieldId | null>(null)

  // Use custom field mutations hook (reorderField for reorder, destroy for delete, create handled in CustomFieldDialog)
  const { destroy, reorderField } = useCustomFieldMutations({
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
  // RESOURCE FIELDS (with optimistic overlays from store)
  // ─────────────────────────────────────────────────────────────────

  // Get fields with optimistic overlays - subscribes to fieldMap for instant updates
  const { fields: effectiveFields, isLoading: fieldsLoading } =
    useResourceFields(entityDefinitionId)

  // ─────────────────────────────────────────────────────────────────
  // FIELD PROCESSING (unified system + custom)
  // ─────────────────────────────────────────────────────────────────

  // Get unified field list sorted for display
  const displayFields = useMemo(() => {
    if (!effectiveFields.length) return []
    return sortFieldsForDisplay(effectiveFields)
  }, [effectiveFields])

  // Enrich fields with dynamic options
  const { fields: enrichedFields, isLoading: optionsLoading } =
    useDynamicFieldOptions(displayFields)

  // Use enriched fields directly - optimistic updates are handled by fieldMap in the store
  const sortedFields = enrichedFields

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
    if (!over) return

    const customFields = filteredFields.filter((f) => !f.isSystem)
    reorderField(customFields, active.id, over.id)
  }

  // ─────────────────────────────────────────────────────────────────
  // FIELD MANAGEMENT (create/edit/delete custom fields)
  // ─────────────────────────────────────────────────────────────────

  const handleAddField = () => {
    setEditingResourceFieldId(null)
    setDialogOpen(true)
  }

  const handleEditField = (_fieldId: string, field: any) => {
    // Build resourceFieldId from field - fields from Resource have resourceFieldId property
    const rfId = field.resourceFieldId ?? toResourceFieldId(entityDefinitionId, field.id)
    setEditingResourceFieldId(rfId)
    setDialogOpen(true)
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
      await destroy.mutateAsync({
        resourceFieldId: toResourceFieldId(entityDefinitionId, fieldId),
      })
      onMutationSuccess?.()
    }
  }

  /**
   * Determine if a field is sortable (only custom fields)
   */
  const isSortable = (field: ResourceField) => {
    return !field.isSystem // && field.capabilities.updatable !== false
  }

  const isLoading = fieldsLoading || optionsLoading

  return (
    <FieldNavigationProvider>
      <EntityFieldsContent
        className={className}
        isEditMode={isEditMode}
        setIsEditMode={setIsEditMode}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        editingResourceFieldId={editingResourceFieldId}
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
        recordId={recordId}
        canEdit={canEdit}
        readOnly={readOnly}
        showTitle={showTitle}
        onMutationSuccess={onMutationSuccess}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
