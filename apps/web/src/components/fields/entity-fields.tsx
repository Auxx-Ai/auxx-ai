// apps/web/src/components/fields/entity-fields.tsx
'use client'

import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import {
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useResourceFields } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { EntityFieldsContent } from './entity-fields-content'
import { FieldNavigationProvider } from './field-navigation-context'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { useFieldPopoverCoordination } from './hooks/use-field-popover-coordination'
import { useFieldView } from './hooks/use-field-view'
import { useToggleFieldVisibility } from './hooks/use-toggle-field-visibility'
import type { PanelField } from './rows/types'

/**
 * Props for EntityFields component.
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
  /**
   * Array of field keys to exclusively include — the complement of
   * `excludeFields`. When set, only these fields render (e.g. a context card
   * showing a field subset). Applied after `excludeFields`.
   */
  includeFields?: string[]
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
  includeFields,
}: EntityFieldsProps) {
  // Parse recordId to get entityDefinitionId
  const { entityDefinitionId } = parseRecordId(recordId)

  // The panel edit mode manages FIELD DEFINITIONS (add/edit/delete/reorder custom
  // fields), which is def administration (the `Full`/`admin` rung) — NOT record
  // editing. Gate the edit-mode affordances on it; the server enforces regardless.
  const { canAdministerDef } = useAccess()
  const canManageFields = canEdit && canAdministerDef(entityDefinitionId)

  // One-open-editor-at-a-time coordination across rows
  const {
    onOpenChange: handleProviderOpenChange,
    registerClose: registerProviderClose,
    unregisterClose: unregisterProviderClose,
  } = useFieldPopoverCoordination()

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
  // FIELD VIEW (org-wide configuration for panel context)
  // ─────────────────────────────────────────────────────────────────

  // Get field IDs for view config (needed for lazy view creation)
  const fieldIds = useMemo(
    () => effectiveFields.map((f) => f.resourceFieldId ?? f.id ?? f.key),
    [effectiveFields]
  )

  // Use field view hook for visibility and ordering
  const {
    getVisibleFields,
    getAllFields,
    isFieldVisible,
    isLoading: fieldViewLoading,
  } = useFieldView({
    entityDefinitionId,
    contextType: 'panel',
    fields: effectiveFields,
    enabled: effectiveFields.length > 0,
  })

  // Use toggle field visibility hook
  const { toggle: toggleFieldVisibility } = useToggleFieldVisibility({
    entityDefinitionId,
    contextType: 'panel',
    fieldIds,
  })

  // ─────────────────────────────────────────────────────────────────
  // FIELD PROCESSING (unified system + custom)
  // ─────────────────────────────────────────────────────────────────

  // Get fields filtered and ordered by field view config
  // In edit mode, show all fields (so user can toggle hidden ones back on)
  const displayFields = useMemo(() => {
    if (!effectiveFields.length) return []
    return isEditMode ? getAllFields() : getVisibleFields()
  }, [effectiveFields, isEditMode, getAllFields, getVisibleFields])

  // Enrich fields with dynamic options
  const { fields: enrichedFields, isLoading: optionsLoading } =
    useDynamicFieldOptions(displayFields)

  // Use enriched fields directly - optimistic updates are handled by fieldMap in the store
  const sortedFields = enrichedFields

  // Apply field exclusion/inclusion filters (exclude first, then include subset)
  const filteredFields = useMemo(() => {
    let fields = sortedFields
    if (excludeFields?.length) {
      fields = fields.filter((field) => !excludeFields.includes(field.key))
    }
    if (includeFields?.length) {
      const include = new Set(includeFields)
      fields = fields.filter((field) => include.has(field.key))
    }
    return fields
  }, [sortedFields, excludeFields, includeFields])

  // Note: Field value mutations are handled internally by PropertyProvider via storeConfig

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

  const handleEditField = (_fieldId: string, field: PanelField) => {
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

  const isLoading = fieldsLoading || optionsLoading || fieldViewLoading

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
        canEdit={canManageFields}
        readOnly={readOnly}
        showTitle={showTitle}
        onMutationSuccess={onMutationSuccess}
        onToggleVisibility={toggleFieldVisibility}
        isFieldVisible={isFieldVisible}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
