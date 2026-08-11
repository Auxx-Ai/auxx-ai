// apps/web/src/components/fields/entity-fields.tsx
'use client'

import type { FieldGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useMemo, useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useResourceFields } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { EntityFieldsContent } from './entity-fields-content'
import { FieldNavigationProvider } from './field-navigation-context'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { useFieldGroupDnd } from './hooks/use-field-group-dnd'
import { useFieldPopoverCoordination } from './hooks/use-field-popover-coordination'
import { resolveFieldVisible, useFieldView } from './hooks/use-field-view'
import { useFieldViewDraft } from './hooks/use-field-view-draft'
import type { PanelField } from './rows/types'

/** The id a field is keyed by in `FieldViewConfig.fieldOrder` / `fieldVisibility`. */
function viewFieldId(field: ResourceField): string {
  return String(field.resourceFieldId ?? field.id ?? field.key)
}

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

  // Field-definition dialog state (create/edit a CustomField — unrelated to the view)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingResourceFieldId, setEditingResourceFieldId] = useState<ResourceFieldId | null>(null)

  // Field-definition mutations (create/edit live in CustomFieldDialog). Field
  // ORDER is NOT written here — it lives in `FieldViewConfig.fieldOrder`.
  const { destroy } = useCustomFieldMutations({
    entityDefinitionId,
  })

  // Confirm dialog for delete
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Confirm dialog for leaving edit mode with unsaved view changes. Separate
  // instance from the delete one so neither has to borrow the other's naming;
  // they can never be open at the same time.
  const [confirmExit, ConfirmExitDialog] = useConfirm()

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

  // Use field view hook for visibility and ordering (the PERSISTED view)
  const {
    config: viewConfig,
    getVisibleFields,
    isFieldVisible: isFieldVisibleInView,
    isLoading: fieldViewLoading,
  } = useFieldView({
    entityDefinitionId,
    contextType: 'panel',
    fields: effectiveFields,
    enabled: effectiveFields.length > 0,
  })

  // ─────────────────────────────────────────────────────────────────
  // EDIT MODE (draft buffer + explicit save — shared with the record dialog)
  // ─────────────────────────────────────────────────────────────────

  // Order and visibility are both edited in a local buffer and persisted by one
  // config write on Save View. Nothing here touches `CustomField.sortOrder`.
  const {
    draft,
    isDraftMode: isEditMode,
    isDraftDirty,
    isSaving,
    enterDraft,
    cancelDraft,
    setDraftVisibility,
    reorderDraft,
    saveDraft,
    draftGroups,
    addGroup,
    renameGroup,
    deleteGroup,
    assignFieldToGroup,
    moveGroup,
  } = useFieldViewDraft({
    entityDefinitionId,
    contextType: 'panel',
    fields: effectiveFields,
  })

  // Groups the panel renders: the unsaved draft's while editing, the saved org
  // view's otherwise. A group has no stored position — its header renders where
  // its first member sits in the field order (see `group-fields.ts`).
  const fieldGroups: FieldGroup[] = isEditMode ? draftGroups : (viewConfig.fieldGroups ?? [])

  /**
   * Leaving edit mode via the header's X.
   *
   * The X reads as "close this", not "throw my work away", so an untouched draft
   * just closes and a modified one asks first. Saving here is exactly Save View —
   * the same `saveDraft`, one config write — so the prompt is a route to it, not
   * a second write path.
   *
   * `saveDraft` never rejects: on failure it toasts and leaves the draft intact,
   * so a failed save keeps the user in edit mode with their changes rather than
   * closing over them.
   *
   * The footer's explicit Cancel is deliberately NOT routed through here — it
   * sits beside Save View, so the choice has already been put to the user.
   */
  const handleExitEditMode = useCallback(async () => {
    if (!isDraftDirty) {
      cancelDraft()
      return
    }

    const shouldSave = await confirmExit({
      title: 'Save changes to this view?',
      description:
        'Your changes to the field layout have not been saved. Saving applies them for everyone in the organization.',
      confirmText: 'Save',
      cancelText: 'Discard',
    })

    if (shouldSave) await saveDraft()
    else cancelDraft()
  }, [isDraftDirty, cancelDraft, confirmExit, saveDraft])

  // ─────────────────────────────────────────────────────────────────
  // FIELD PROCESSING (unified system + custom)
  // ─────────────────────────────────────────────────────────────────

  // Fast lookup keyed the same way `fieldOrder` / `fieldVisibility` are
  const fieldByViewId = useMemo(
    () => new Map(effectiveFields.map((f) => [viewFieldId(f), f])),
    [effectiveFields]
  )

  // Edit mode renders from the DRAFT's order, not the persisted view, so a drag
  // is reflected immediately and Cancel discards it. Registry-hidden fields stay
  // out (they are system-internal and must not be configurable).
  const draftFields = useMemo((): ResourceField[] => {
    if (!draft) return []
    const remaining = new Map(fieldByViewId)
    const ordered: ResourceField[] = []
    for (const fieldId of draft.fieldOrder) {
      const field = remaining.get(fieldId)
      if (!field) continue
      remaining.delete(fieldId)
      if (field.capabilities.hidden) continue
      ordered.push(field)
    }
    for (const [, field] of remaining) {
      if (field.capabilities.hidden) continue
      ordered.push(field)
    }
    return ordered
  }, [draft, fieldByViewId])

  // Get fields filtered and ordered by field view config.
  // In edit mode, show all fields (so the user can toggle hidden ones back on).
  const displayFields = useMemo(() => {
    if (!effectiveFields.length) return []
    return isEditMode ? draftFields : getVisibleFields()
  }, [effectiveFields, isEditMode, draftFields, getVisibleFields])

  // In edit mode the switches must reflect the UNSAVED draft; otherwise they
  // report the persisted view. Mirrors `useFieldView.isFieldVisible` so a field
  // with no explicit entry still resolves to its registry default.
  const isFieldVisible = useCallback(
    (fieldId: string): boolean => {
      if (!draft) return isFieldVisibleInView(fieldId)
      const field = fieldByViewId.get(fieldId)
      if (!field) return draft.fieldVisibility[fieldId] !== false
      return resolveFieldVisible(field, 'panel', draft.fieldVisibility)
    },
    [draft, fieldByViewId, isFieldVisibleInView]
  )

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

  // The field half of drop routing, shared verbatim with the record dialog.
  // `FieldGroupList` splits by WHAT was dragged and sends group-header drags to
  // `moveGroup` — a block move changes order only, never membership.
  const { handleFieldDragEnd, placeFieldBesideGroup } = useFieldGroupDnd({
    draft,
    draftGroups,
    assignFieldToGroup,
    reorderDraft,
  })

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

  // ─────────────────────────────────────────────────────────────────
  // GROUP MANAGEMENT (draft only — persisted with Save View)
  // ─────────────────────────────────────────────────────────────────

  const handleAddGroup = () => addGroup('New group')

  const handleDeleteGroup = async (groupId: string, label: string) => {
    // An EMPTY group has nothing to lose — no field changes hands and the draft
    // is still discardable with Cancel — so a confirm is pure friction on the
    // most likely case: created one by mistake, remove it again.
    const memberCount = draftGroups.find((g) => g.id === groupId)?.fieldIds.length ?? 0
    if (memberCount === 0) {
      deleteGroup(groupId)
      return
    }

    const confirmed = await confirmDelete({
      title: 'Delete group?',
      description: `"${label}" will be removed and its ${memberCount} field${memberCount === 1 ? '' : 's'} become ungrouped. No field is deleted — only the group.`,
      confirmText: 'Delete group',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) deleteGroup(groupId)
  }

  /**
   * Every rendered field is sortable. Order lives in `FieldViewConfig.fieldOrder`,
   * which is keyed by field id regardless of whether the field is a system field,
   * so there is no reason to pin system fields in place — and excluding them here
   * while still rendering them made dnd-kit's index math land on the wrong slot.
   */
  const isSortable = () => true

  const isLoading = fieldsLoading || optionsLoading || fieldViewLoading

  return (
    <FieldNavigationProvider>
      <ConfirmExitDialog />
      <EntityFieldsContent
        className={className}
        isEditMode={isEditMode}
        onEnterEditMode={enterDraft}
        onCancelEditMode={cancelDraft}
        onExitEditMode={handleExitEditMode}
        onSaveView={saveDraft}
        isSaving={isSaving}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        editingResourceFieldId={editingResourceFieldId}
        sensors={sensors}
        handleDragEnd={handleFieldDragEnd}
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
        onToggleVisibility={setDraftVisibility}
        isFieldVisible={isFieldVisible}
        fieldGroups={fieldGroups}
        onAddGroup={canManageFields ? handleAddGroup : undefined}
        onRenameGroup={renameGroup}
        onDeleteGroup={handleDeleteGroup}
        onMoveGroup={moveGroup}
        onPlaceFieldBesideGroup={placeFieldBesideGroup}
      />
    </FieldNavigationProvider>
  )
}

export default EntityFields
