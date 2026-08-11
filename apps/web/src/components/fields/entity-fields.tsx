// apps/web/src/components/fields/entity-fields.tsx
'use client'

import type { FieldGroup } from '@auxx/lib/conditions/client'
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
import { useCallback, useMemo, useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useResourceFields } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { EntityFieldsContent } from './entity-fields-content'
import { FieldNavigationProvider } from './field-navigation-context'
import { useDynamicFieldOptions } from './hooks/use-dynamic-field-options'
import { useFieldPopoverCoordination } from './hooks/use-field-popover-coordination'
import { resolveFieldVisible, useFieldView } from './hooks/use-field-view'
import { useFieldViewDraft } from './hooks/use-field-view-draft'
import { parseGroupDropId } from './rows/field-group-row'
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

  /** The group a field currently belongs to in the draft, or null if ungrouped. */
  const draftGroupIdOf = useCallback(
    (fieldId: string): string | null =>
      draftGroups.find((group) => group.fieldIds.includes(fieldId))?.id ?? null,
    [draftGroups]
  )

  /**
   * The FIELD half of the drag-end routing (`EntityFieldsContent.routeDragEnd`
   * splits by what is being dragged, and sends group-header drags to
   * `moveGroup` instead — a block move changes order only, never membership).
   *
   * Reordering moves the field within the DRAFT's `fieldOrder`. The dnd ids are
   * the same ids `fieldOrder` stores (see `viewFieldId`) — mismatched ids would
   * make this a silent no-op.
   *
   * Group membership is derived from where the field LANDED: because a group's
   * members are contiguous, the row a field is dropped among identifies exactly
   * one group (or none, outside every block), and that is the drop's intent. A
   * drop on a group HEADER addresses the group directly — headers are drop
   * targets for every block now that they are sortables in their own right, so
   * this is how a field joins a group whose members it cannot aim at (an empty
   * or collapsed one) as well as one it can.
   *
   * Membership is applied FIRST, then the reorder: `assignFieldToGroup` moves
   * membership and position together so the target block keeps its anchor, and
   * the reorder that follows settles the field into the exact slot it was
   * dropped on. Both are functional `setDraft` updaters, so the second observes
   * the first within this handler. A same-group drag skips the assignment — it
   * is a no-op on membership but not on position, so running it would move the
   * field twice.
   *
   * `edge` is why the reorder cannot be a bare `arrayMove`. Joining a group
   * relocates the field to the block's TAIL, so a field dragged DOWN into a
   * group arrives above its target having travelled up — and an arrayMove reads
   * direction from the post-assignment position, landing it one slot early
   * (dropping on the last member put it second-to-last). The caller passes the
   * same edge the insert line was drawn from, so the drop lands where the line
   * promised.
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent, edge?: 'before' | 'after') => {
      const { active, over } = event
      if (!over) return

      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      const currentGroupId = draftGroupIdOf(activeId)

      // Header drop. An EMPTY group has no members to aim at, so the header is
      // the only target and assign-only is right — the field keeps its position
      // and the group forms around it. A group that HAS members is different:
      // assign-only would silently append the field to the end of the block, so
      // a drop near the top of a group would fling the row to its bottom. Land
      // it at the head of the block instead, which is what dropping on a header
      // reads as.
      const headerGroupId = parseGroupDropId(overId)
      if (headerGroupId) {
        if (headerGroupId !== currentGroupId) assignFieldToGroup(activeId, headerGroupId)
        const firstMemberId = draftGroups
          .find((group) => group.id === headerGroupId)
          ?.fieldIds.find((id) => id !== activeId)
        // `before` states the intent outright — dropping on a header means the
        // head of the block, whichever direction the field travelled from. An
        // EMPTY group has no first member, and none is needed: the assignment
        // has already sent the field to where an empty group renders.
        if (firstMemberId) reorderDraft(activeId, firstMemberId, 'before')
        return
      }

      const targetGroupId = draftGroupIdOf(overId)

      if (targetGroupId !== currentGroupId) assignFieldToGroup(activeId, targetGroupId)
      reorderDraft(activeId, overId, edge)
    },
    [assignFieldToGroup, draftGroupIdOf, draftGroups, reorderDraft]
  )

  /**
   * Land a field BESIDE a group's block, belonging to no group.
   *
   * This is the position the drag model had no vocabulary for, and its absence
   * was a real trap: with only row ids as drop targets, every target near a
   * group reads as "join that group", so a group rendered first in the panel
   * swallowed any field dragged toward the top of the list. The `-before` /
   * `-after-group` droppables name those two positions; this applies them.
   *
   * Why the round trip THROUGH the group rather than `assignFieldToGroup(null)`
   * plus a reorder: aiming at the group's first member is direction-sensitive
   * unless the edge is named. Joining the block first puts the field at a known
   * end of it, and leaving the block then keeps that slot —
   * `assignFieldToGroupInOrder` re-anchors the block at its first remaining
   * MEMBER, so a departing field at the head floats above the block and one at
   * the tail floats below it. The result is the same in both drag directions.
   *
   * All three writes are functional `setDraft` updaters, so each observes the
   * previous one within this handler.
   */
  const placeFieldBesideGroup = useCallback(
    (fieldId: string, groupId: string, side: 'before' | 'after') => {
      const memberSet = new Set(draftGroups.find((g) => g.id === groupId)?.fieldIds ?? [])

      // Members in DISPLAY order, from `fieldOrder` — NOT the group's own
      // `fieldIds` array. Membership is a set whose array order is only a
      // tie-break; it drifts from the rendered order the moment anything is
      // reordered inside the group. Reading `fieldIds[0]` as "the top of the
      // block" therefore aimed step 2 at an arbitrary member, and a field
      // dropped ABOVE a group landed in the middle of it — from where step 3's
      // re-normalisation pushed it out BELOW the whole block.
      const memberIds = (draft?.fieldOrder ?? []).filter(
        (id) => id !== fieldId && memberSet.has(id)
      )

      // 1. Join the block — `assignFieldToGroup` places it at the block's end
      //    without moving the block itself.
      assignFieldToGroup(fieldId, groupId)

      // 2. For `before`, pull it to the head; for `after` it is already at the
      //    tail, since step 1 appends.
      const firstMemberId = memberIds[0]
      if (side === 'before' && firstMemberId) reorderDraft(fieldId, firstMemberId, 'before')

      // 3. Leave every group, keeping the slot just established.
      assignFieldToGroup(fieldId, null)
    },
    [assignFieldToGroup, draft, draftGroups, reorderDraft]
  )

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
