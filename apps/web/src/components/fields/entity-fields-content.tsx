// apps/web/src/components/fields/entity-fields-content.tsx
'use client'

import type { FieldGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import type {
  CollisionDetection,
  DragOverEvent,
  DragStartEvent,
  SensorDescriptor,
  SensorOptions,
} from '@dnd-kit/core'
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  pointerWithin,
} from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Pencil, X } from 'lucide-react'
import type React from 'react'
import { Fragment, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { AddFieldRow } from './add-field-row'
import { useFieldNavigation } from './field-navigation-context'
import { type FieldGroupLike, type GroupedFieldSection, groupFieldOrder } from './group-fields'
import { FieldEditRow } from './rows/field-edit-row'
import { AddGroupRow, FieldGroupRow, parseGroupDropId } from './rows/field-group-row'
import {
  type FieldDropTarget,
  FieldDropZone,
  FieldInsertLine,
  fieldBeforeDropId,
  groupAfterDropId,
  groupBeforeDropId,
  groupDropId,
  resolveDropTarget,
} from './rows/field-insert-line'
import { FieldValueRow } from './rows/field-value-row'
import { toPanelField } from './rows/to-panel-field'
import type { PanelField } from './rows/types'

/**
 * Props for EntityFieldsContent component (unified version)
 */
export interface EntityFieldsContentProps {
  className?: string
  isEditMode: boolean
  /** Enter edit mode (snapshots the current view into a draft buffer) */
  onEnterEditMode: () => void
  /** Leave edit mode, discarding the draft — the footer's explicit Cancel */
  onCancelEditMode: () => void
  /**
   * Leave edit mode via the header's X. Unlike Cancel this is not a decision to
   * discard, so the owner prompts to save or discard when the draft is dirty.
   */
  onExitEditMode: () => void | Promise<void>
  /** Persist the draft (order + visibility) as one config write */
  onSaveView: () => void | Promise<void>
  /** Whether the view config is currently being persisted */
  isSaving?: boolean
  dialogOpen: boolean
  setDialogOpen: (value: boolean) => void
  editingResourceFieldId: ResourceFieldId | null
  sensors: SensorDescriptor<SensorOptions>[]
  /**
   * Drop handler for a FIELD drag. `edge` names which side of the target the
   * field lands on, read from the pre-drag positions so the drop agrees with
   * the insert line.
   */
  handleDragEnd: (event: DragEndEvent, edge?: 'before' | 'after') => void
  /** Unified sorted fields (system + custom) */
  fields: ResourceField[]
  /** Loading state */
  isLoading: boolean
  /** Check if field is sortable */
  isSortable: (field: ResourceField) => boolean
  handleDeleteField: (fieldId: string, fieldName: string) => Promise<void>
  handleEditField: (fieldId: string, field: PanelField) => void
  handleAddField: () => void
  handleProviderOpenChange: (providerId: string, nextOpen: boolean) => void
  registerProviderClose: (providerId: string, closeFn: () => void) => void
  unregisterProviderClose: (providerId: string) => void
  ConfirmDeleteDialog: React.FC
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Whether fields can be edited (default: true) */
  canEdit?: boolean
  /** Whether all fields are read-only (default: false) */
  readOnly?: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle?: boolean
  /** Callback after successful mutation */
  onMutationSuccess?: () => void
  /** Handler for toggling field visibility (edit mode only — writes the draft) */
  onToggleVisibility?: (resourceFieldId: string, visible: boolean) => void
  /** Check if a field is visible (the draft in edit mode, else the saved view) */
  isFieldVisible?: (fieldId: string) => boolean
  /**
   * Field groups for the rendered order — the draft's in edit mode, the saved
   * view's otherwise. A group carries no position: its header renders where its
   * first member sits in the field order.
   */
  fieldGroups?: FieldGroup[]
  /** Edit mode only — create an empty group, returning its id. */
  onAddGroup?: () => string
  /** Edit mode only — rename a group in the draft. */
  onRenameGroup?: (groupId: string, label: string) => void
  /** Edit mode only — delete a group (members become ungrouped; no field is deleted). */
  onDeleteGroup?: (groupId: string, label: string) => void
  /**
   * Edit mode only — move a whole group block to the drop target. `overId` is a
   * bare group id when `overIsGroup`, otherwise a field id. Order only: a block
   * move never changes membership.
   */
  onMoveGroup?: (groupId: string, overId: string, overIsGroup: boolean) => void
  /**
   * Edit mode only — place a field immediately before or after a group's block,
   * belonging to NO group. The position the row-id-only drag model could not
   * name: every target near a group used to read as "join that group", so a
   * group rendered first swallowed anything dragged to the top of the list.
   */
  onPlaceFieldBesideGroup?: (fieldId: string, groupId: string, side: 'before' | 'after') => void
}

/**
 * Inner component that uses the navigation context
 * Renders the unified field list with drag-and-drop support
 */
export function EntityFieldsContent({
  className,
  isEditMode,
  onEnterEditMode,
  onCancelEditMode,
  onExitEditMode,
  onSaveView,
  isSaving = false,
  dialogOpen,
  setDialogOpen,
  editingResourceFieldId,
  sensors,
  handleDragEnd,
  fields,
  isLoading,
  isSortable,
  handleDeleteField,
  handleEditField,
  handleAddField,
  handleProviderOpenChange,
  registerProviderClose,
  unregisterProviderClose,
  ConfirmDeleteDialog,
  recordId,
  onMutationSuccess,
  canEdit = true,
  readOnly = false,
  showTitle = true,
  onToggleVisibility,
  isFieldVisible,
  fieldGroups,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onPlaceFieldBesideGroup,
}: EntityFieldsContentProps) {
  // Parse recordId to get entityDefinitionId
  const { entityDefinitionId } = parseRecordId(recordId)

  const containerRef = useRef<HTMLDivElement>(null)
  const { focusedRowId, moveFocus, openFocusedRow, isPopoverCapturing } = useFieldNavigation()

  /**
   * Handle keyboard navigation at container level
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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

  /**
   * Normalize a registry field into the shape rows consume, and derive the ids
   * each row needs. System fields have no DB id, so they fall back to their key.
   *
   * `id` is the drag-and-drop id AND the visibility key, and it is deliberately
   * the id `FieldViewConfig.fieldOrder` / `fieldVisibility` store — anything else
   * makes a reorder or a toggle a silent no-op against the draft config.
   */
  const rows = fields.map((field, index) => {
    const isSystemField = field.isSystem === true
    const fieldId = field.id || field.key
    const viewFieldId = String(field.resourceFieldId ?? field.id ?? field.key)
    return {
      id: viewFieldId,
      index,
      isSystemField,
      // System keys and custom-field ids share one namespace, so system rows are
      // prefixed to guarantee uniqueness.
      providerId: isSystemField ? `system-${field.key}` : fieldId,
      resourceFieldId: viewFieldId,
      isVisible: isFieldVisible?.(viewFieldId) ?? true,
      isSortable: isSortable(field),
      field: toPanelField(field, readOnly),
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // GROUPS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Collapse is LOCAL and read-mode only, deliberately.
   *
   * `FieldGroup.collapsed` is part of the org's shared default view — one config
   * row every member of the org reads. Persisting a chevron click would be a
   * server write per click that collapses the group for *everyone*, which is not
   * what "I want this section out of my way right now" means. So collapse is a
   * per-mount override layered on the persisted default.
   *
   * Nothing writes that persisted default today: edit mode forces every group
   * open and shows no chevron, so there is no UI for it. The schema field and
   * the draft hook's `setGroupCollapsed` remain, since a "starts collapsed"
   * option is the natural place to wire it back up.
   */
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({})

  /**
   * Edit mode forces every group OPEN. You are rearranging structure there —
   * dragging fields between groups and groups past each other — and a hidden
   * block is a block you cannot drop into or see the result of. It also removes
   * the collapsed-group drop target, which was the main source of drop
   * ambiguity: with every member row visible, a drop always has a real row to
   * resolve against instead of a header standing in for hidden content.
   */
  const isGroupCollapsed = (group: FieldGroup): boolean => {
    if (isEditMode) return false
    return collapsedOverrides[group.id] ?? group.collapsed ?? false
  }

  const toggleGroupCollapsed = (group: FieldGroup) => {
    if (isEditMode) return
    setCollapsedOverrides((prev) => ({ ...prev, [group.id]: !isGroupCollapsed(group) }))
  }

  /** The group whose label input should take focus (just created in this session). */
  const [newGroupId, setNewGroupId] = useState<string | null>(null)

  const handleAddGroup = () => {
    const groupId = onAddGroup?.()
    if (groupId) setNewGroupId(groupId)
  }

  // Sections are derived from the ids that actually render, so exclusion filters
  // and hidden fields can never leave a group claiming a field the list doesn't
  // show. Empty groups only exist in edit mode, where they are drop targets;
  // read mode drops them entirely.
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const sections = groupFieldOrder({
    fieldOrder: rows.map((row) => row.id),
    groups: fieldGroups ?? [],
    includeEmptyGroups: isEditMode,
  })

  // The flat visible field sequence: a collapsed group contributes NO rows, so
  // its members are neither in the sortable set nor registered with the keyboard
  // navigation context (rows register themselves on mount — not rendering them
  // is what keeps them unreachable by arrow keys).
  const visibleRowIds = sections.flatMap((section) =>
    section.group && isGroupCollapsed(section.group) ? [] : section.fieldIds
  )
  const navIndexById = new Map(visibleRowIds.map((id, index) => [id, index]))

  // ─────────────────────────────────────────────────────────────────
  // DRAG MODEL — insert lines, not displacement
  // ─────────────────────────────────────────────────────────────────

  /**
   * There is deliberately NO `SortableContext` here, and no sorting strategy.
   *
   * A group is a header plus a contiguous member block, and a displacement
   * strategy cannot express "this whole block moves": it displaces individual
   * rows by the dragged node's height, so a group drag either moved the header
   * alone or (with a `DragOverlay`) shoved every row down by the block's height
   * while the block was still in flow. The KB sidebar solved the same problem by
   * dropping the strategy entirely — `useSortable` is kept purely for
   * `isDragging`/`attributes`/`listeners`, nothing displaces, and the answer to
   * "where will this land" is stated explicitly by an insert line plus a
   * whole-group highlight. This is that model (see `rows/field-insert-line.tsx`
   * for the id keyspace).
   *
   * Consequence worth knowing: without a `SortableContext` `useSortable` never
   * resolves a transform, so the dragged row does not follow the pointer — it
   * dims to 0.3 and stays put. A `DragOverlay` is now safe to add if a ghost is
   * wanted (the displacement failure mode that killed the last attempt lived in
   * the strategy, which is gone), but it is not needed for the affordance.
   */
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<FieldDropTarget | null>(null)

  /** The group being dragged, or null when a field row is in hand. */
  const activeGroupId = activeDragId === null ? null : parseGroupDropId(activeDragId)

  const memberIdsOfGroup = (groupId: string): string[] =>
    sections.find((section) => section.group?.id === groupId)?.fieldIds ?? []

  /**
   * What the drag ghost renders: the whole block for a group drag, one row for a
   * field drag. Null when nothing is in hand, which is what keeps the overlay
   * unmounted the rest of the time.
   */
  const activeGroupSection =
    activeGroupId === null
      ? undefined
      : sections.find((section) => section.group?.id === activeGroupId)
  const activeFieldRow =
    activeDragId !== null && activeGroupId === null ? rowById.get(activeDragId) : undefined

  // Positions are compared in the RENDERED order (which is `fieldOrder`,
  // group-contiguous) so the insert line can be drawn on the edge the drop
  // actually lands on — see `deriveDropFeedback`.
  const renderedOrder = sections.flatMap((section) => section.fieldIds)
  const orderIndexById = new Map(renderedOrder.map((fieldId, index) => [fieldId, index]))
  const groupIdByFieldId = new Map<string, string>()
  for (const section of sections) {
    if (!section.group) continue
    for (const fieldId of section.fieldIds) groupIdByFieldId.set(fieldId, section.group.id)
  }

  /** Where the dragged thing sits today: a field's slot, or a block's anchor. */
  const activeAnchorIndex = (() => {
    if (activeDragId === null) return -1
    if (activeGroupId === null) return orderIndexById.get(activeDragId) ?? -1
    const firstMemberId = memberIdsOfGroup(activeGroupId)[0]
    return firstMemberId === undefined ? -1 : (orderIndexById.get(firstMemberId) ?? -1)
  })()

  /**
   * `reorderDraft` and `moveGroupBlock` are both direction-sensitive: dragging
   * DOWN onto a target lands after it, dragging UP lands at it. So the line is
   * drawn on the target's bottom edge for a downward drag and its top edge for
   * an upward one — otherwise the affordance would promise a slot the drop does
   * not deliver.
   */
  const edgeFor = (targetIndex: number): 'top' | 'bottom' =>
    activeAnchorIndex >= 0 && targetIndex >= 0 && activeAnchorIndex < targetIndex ? 'bottom' : 'top'

  type DropIndicator =
    | { kind: 'row'; rowId: string; side: 'top' | 'bottom'; inset: boolean }
    | { kind: 'group'; groupId: string; side: 'top' | 'bottom'; inset: boolean }

  /**
   * Turn the hovered droppable into the ONE line to draw and the ONE group to
   * light up.
   *
   * The highlight answers "will this end up INSIDE that group", and its colour
   * answers it in both directions:
   *
   * - `blocked: false` (blue) — a FIELD about to join the group. It really will
   *   be a member.
   * - `blocked: true` (grey) — a GROUP hovering another group. Groups do not
   *   nest, so the drop repositions the block against that group's boundary
   *   instead. The fill says "not into this"; the insert line still says where
   *   the block lands, which is why lines stay blue in both cases.
   *
   * Deliberately NOT drawn for `group-before`/`group-after`: those land the
   * field outside every group, so there is no group to be inside of.
   */
  const deriveDropFeedback = (): {
    indicator: DropIndicator | null
    highlight: { groupId: string; blocked: boolean } | null
  } => {
    if (dropTarget === null || activeDragId === null) {
      return { indicator: null, highlight: null }
    }

    const anchorIndexOfGroup = (groupId: string): number => {
      const firstMemberId = memberIdsOfGroup(groupId)[0]
      return firstMemberId === undefined ? -1 : (orderIndexById.get(firstMemberId) ?? -1)
    }

    // A GROUP drag always snaps to a whole block boundary (`moveGroupBlock`
    // never splits another group), so a field target resolves to that field's
    // group when it has one.
    if (activeGroupId !== null) {
      const referenceGroupId =
        dropTarget.kind === 'field'
          ? (groupIdByFieldId.get(dropTarget.fieldId) ?? null)
          : dropTarget.groupId
      if (referenceGroupId === null) {
        const fieldId = dropTarget.kind === 'field' ? dropTarget.fieldId : null
        if (fieldId === null) return { indicator: null, highlight: null }
        const side = edgeFor(orderIndexById.get(fieldId) ?? -1)
        return {
          indicator: { kind: 'row', rowId: fieldId, side, inset: false },
          highlight: null,
        }
      }
      if (referenceGroupId === activeGroupId) return { indicator: null, highlight: null }
      const side = edgeFor(anchorIndexOfGroup(referenceGroupId))
      return {
        indicator: { kind: 'group', groupId: referenceGroupId, side, inset: false },
        // A group hovering a group: the block lands beside it, never inside it.
        highlight: { groupId: referenceGroupId, blocked: true },
      }
    }

    switch (dropTarget.kind) {
      case 'field': {
        const side = edgeFor(orderIndexById.get(dropTarget.fieldId) ?? -1)
        const targetGroupId = groupIdByFieldId.get(dropTarget.fieldId) ?? null
        return {
          indicator: { kind: 'row', rowId: dropTarget.fieldId, side, inset: false },
          highlight: targetGroupId === null ? null : { groupId: targetGroupId, blocked: false },
        }
      }
      case 'group-into': {
        // A field dropped on the header lands at the HEAD of the block, so the
        // line belongs above the first member — not above the header, which is
        // the `group-before` position and means something else entirely.
        const firstMemberId = memberIdsOfGroup(dropTarget.groupId).find((id) => id !== activeDragId)
        return {
          indicator:
            firstMemberId === undefined
              ? null
              : { kind: 'row', rowId: firstMemberId, side: 'top', inset: false },
          highlight: { groupId: dropTarget.groupId, blocked: false },
        }
      }
      case 'group-before':
        return {
          indicator: { kind: 'group', groupId: dropTarget.groupId, side: 'top', inset: false },
          highlight: null,
        }
      case 'group-after':
        return {
          indicator: { kind: 'group', groupId: dropTarget.groupId, side: 'bottom', inset: true },
          highlight: null,
        }
    }
  }

  const { indicator, highlight } = deriveDropFeedback()

  const lineForRow = (rowId: string, side: 'top' | 'bottom'): boolean =>
    indicator?.kind === 'row' && indicator.rowId === rowId && indicator.side === side

  const lineForGroup = (groupId: string, side: 'top' | 'bottom'): boolean =>
    indicator?.kind === 'group' && indicator.groupId === groupId && indicator.side === side

  // `collisionDetection` runs outside the render that produced `sections`, so it
  // reads them through a ref and stays referentially stable.
  const sectionsRef = useRef<GroupedFieldSection[]>(sections)
  sectionsRef.current = sections

  /**
   * `closestCorners` (the KB sidebar's choice), minus the targets that describe
   * a drop the mutation layer would refuse anyway:
   *
   * - a FIELD may not target its own row (`x-before` and the bare `x` both
   *   resolve to the same no-op),
   * - a GROUP may not land inside its own block — its members' rows, its own
   *   header, its own `-before`/`-after-group` boundaries,
   * - a GROUP may not target an EMPTY group at all. An empty group has no index
   *   in `fieldOrder` (its end-of-list slot is a render convention), so
   *   `moveGroupBlock` has no honest insertion point and refuses every one of
   *   its three droppables. Letting it become `over` drew a highlight and an
   *   insert line for a drop that then did nothing. A FIELD drag still targets
   *   it — that is the only way a new group ever gets its first member.
   *
   * Filtering here rather than per-row is what lets every affordance below key
   * off `over` alone: an invalid target simply never becomes `over`, so no
   * component needs its own validity gate.
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    // `pointerWithin` FIRST: the drop zones deliberately overlap each other and
    // the rows (each is `absolute left-0 right-0 h-4` hanging off an edge), and
    // `closestCorners` resolves from the DRAGGED ELEMENT'S rect rather than the
    // cursor — with a long list and vertical-only movement its nearest corner
    // can be a zone nowhere near where the user is pointing. `closestCorners` is
    // kept as the fallback for the gaps where the pointer is inside no zone.
    const collisions = pointerWithin(args).length > 0 ? pointerWithin(args) : closestCorners(args)
    const draggedId = String(args.active.id)
    const draggedGroupId = parseGroupDropId(draggedId)

    if (draggedGroupId === null) {
      return collisions.filter((collision) => {
        const target = resolveDropTarget(String(collision.id))
        return !(target.kind === 'field' && target.fieldId === draggedId)
      })
    }

    const ownMemberIds = new Set(
      sectionsRef.current.find((section) => section.group?.id === draggedGroupId)?.fieldIds ?? []
    )
    const emptyGroupIds = new Set(
      sectionsRef.current
        .filter((section) => section.group !== null && section.fieldIds.length === 0)
        .map((section) => section.group?.id)
    )
    return collisions.filter((collision) => {
      const target = resolveDropTarget(String(collision.id))
      if (target.kind === 'field') return !ownMemberIds.has(target.fieldId)
      return target.groupId !== draggedGroupId && !emptyGroupIds.has(target.groupId)
    })
  }, [])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
    setDropTarget(null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const next = event.over === null ? null : resolveDropTarget(String(event.over.id))
    setDropTarget((prev) => {
      if (prev === null || next === null) return prev === next ? prev : next
      const sameId =
        prev.kind === 'field' && next.kind === 'field'
          ? prev.fieldId === next.fieldId
          : prev.kind !== 'field' && next.kind !== 'field' && prev.groupId === next.groupId
      return prev.kind === next.kind && sameId ? prev : next
    })
  }

  /** A synthetic drag-end aimed at `overId`, so the existing handlers see a normal drop. */
  const aimedAt = (event: DragEndEvent, overId: string): DragEndEvent =>
    event.over === null ? event : { ...event, over: { ...event.over, id: overId } }

  /**
   * Route a drop by WHAT WAS DRAGGED, not by what it landed on.
   *
   * A group header and a field row are the same kind of thing to dnd-kit but
   * different operations here: dragging a group repositions its whole member
   * block (order only — `moveGroup`), while dragging a field can also change
   * which group it belongs to. Running the field path for a group drag would
   * reassign membership from wherever the header happened to land, which is why
   * the two never share a code path.
   *
   * Every branch translates the suffixed droppable id back to the bare field or
   * group id the existing handlers already expect; neither handler is modified.
   */
  const routeDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    setDropTarget(null)

    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const target = resolveDropTarget(String(over.id))
    const draggedGroupId = parseGroupDropId(activeId)

    // GROUP drag — order only. Every group-addressing target collapses to the
    // same call: `moveGroupBlock` owns the snap-to-boundary and direction rules,
    // so "above" vs "below" is its decision, not the droppable's.
    if (draggedGroupId !== null) {
      if (target.kind === 'field') {
        onMoveGroup?.(draggedGroupId, target.fieldId, false)
        return
      }
      if (target.groupId === draggedGroupId) return
      onMoveGroup?.(draggedGroupId, target.groupId, true)
      return
    }

    switch (target.kind) {
      case 'field': {
        if (target.fieldId === activeId) return
        // The SAME expression `deriveDropFeedback` draws the insert line from,
        // so the drop cannot land on a different edge than the line promised.
        // It must be read from the pre-drag positions in this render's closure —
        // `handleDragEnd` may relocate the field (joining a group appends it to
        // the block's tail) before it reorders, which would flip the direction.
        const side = edgeFor(orderIndexById.get(target.fieldId) ?? -1)
        handleDragEnd(aimedAt(event, target.fieldId), side === 'bottom' ? 'after' : 'before')
        return
      }
      case 'group-into':
        handleDragEnd(aimedAt(event, groupDropId(target.groupId)))
        return
      case 'group-before':
        onPlaceFieldBesideGroup?.(activeId, target.groupId, 'before')
        return
      case 'group-after':
        onPlaceFieldBesideGroup?.(activeId, target.groupId, 'after')
        return
    }
  }

  type FieldRow = (typeof rows)[number]

  /** A section's member rows, in the section's own order, ghosts skipped. */
  const memberRowsOf = (fieldIds: string[]): FieldRow[] =>
    fieldIds.flatMap((fieldId) => {
      const row = rowById.get(fieldId)
      return row ? [row] : []
    })

  /**
   * One group header, rendered inside its section wrapper so the wrapper's
   * highlight and boundary lines cover the header and its members as one unit.
   */
  const renderGroupHeader = (
    group: FieldGroupLike,
    memberCount: number,
    autoFocusLabel: boolean,
    preview = false
  ) => (
    <FieldGroupRow
      group={group}
      collapsed={isGroupCollapsed(group)}
      memberCount={memberCount}
      onToggleCollapsed={() => toggleGroupCollapsed(group)}
      isEditMode={isEditMode}
      // The ghost is a picture of what is in hand, not a live row: no rename
      // input to focus, no delete button to hit. Withholding the handlers is
      // what collapses it to icon + title, since the trailing actions only
      // render when their handler exists.
      onRename={
        !preview && isEditMode && onRenameGroup
          ? (label) => onRenameGroup(group.id, label)
          : undefined
      }
      onDelete={
        !preview && isEditMode && onDeleteGroup
          ? () => onDeleteGroup(group.id, group.label)
          : undefined
      }
      autoFocusLabel={!preview && autoFocusLabel}
    />
  )

  /** One member row plus the wrapper carrying its group inset. */
  const renderMemberRow = (
    row: FieldRow,
    options: { grouped: boolean; dimmed?: boolean; preview?: boolean }
  ) => (
    // Grouped rows sit slightly inset so the group's extent is readable
    // without a border. Ungrouped rows keep the flush edge, so the indent
    // alone distinguishes "in this group" from "after it".
    //
    // `dimmed` fades a member of the group currently in hand. `FieldGroupRow`
    // already fades its own header via `isDragging`, but a member row has no
    // idea its group is being dragged — without this only the header dimmed and
    // the block did not read as lifted. Safe now that nothing displaces: there
    // is no `SortableContext`, so dimming cannot desync any layout math.
    <div
      key={row.providerId}
      className={cn('relative', options.grouped && 'ps-3', options.dimmed && 'opacity-30')}>
      {isEditMode && !options.preview && (
        <>
          <FieldDropZone id={fieldBeforeDropId(row.id)} edge='top' />
          {lineForRow(row.id, 'top') && <FieldInsertLine side='top' />}
          {lineForRow(row.id, 'bottom') && <FieldInsertLine side='bottom' />}
        </>
      )}
      {isEditMode ? (
        <FieldEditRow
          id={row.id}
          field={row.field}
          isSortable={row.isSortable}
          resourceFieldId={row.resourceFieldId}
          isVisible={row.isVisible}
          // Preview rows carry no actions — `FieldEditRow` renders the pencil,
          // trash and visibility switch only when handed their handlers, so
          // withholding them is what leaves the ghost as icon + name.
          onEdit={options.preview || row.isSystemField ? undefined : handleEditField}
          onDelete={options.preview || row.isSystemField ? undefined : handleDeleteField}
          onToggleVisibility={options.preview ? undefined : onToggleVisibility}
        />
      ) : (
        <FieldValueRow
          providerId={row.providerId}
          field={row.field}
          index={navIndexById.get(row.id) ?? row.index}
          loading={isLoading}
          recordId={recordId}
          readOnly={readOnly}
          showTitle={showTitle}
          onOpenChange={handleProviderOpenChange}
          registerClose={registerProviderClose}
          unregisterClose={unregisterProviderClose}
        />
      )}
    </div>
  )

  /**
   * Walk the sections into elements: an ungrouped run stays a bare fragment, a
   * group becomes ONE positioned wrapper around its header and members.
   *
   * That wrapper is what makes the group a single visual unit: the dashed
   * highlight is drawn across it, and the two boundaries that address the block
   * from outside (`-before` above the header, `-after-group` below the last
   * member) hang off its edges. It also owns the header's top margin — inside
   * the wrapper the header is always `:first-child`, so `first:mt-0` had to move
   * out with it.
   */
  const renderSections = () =>
    sections.map((section, sectionIndex) => {
      const group = section.group
      const collapsed = group ? isGroupCollapsed(group) : false
      const memberRows = collapsed ? [] : memberRowsOf(section.fieldIds)
      // Every member of the group in hand fades with its header, so the block
      // reads as one thing being lifted rather than a header leaving its rows.
      const blockDimmed = group !== null && group.id === activeGroupId
      const rowElements = memberRows.map((row) =>
        renderMemberRow(row, { grouped: group !== null, dimmed: blockDimmed })
      )

      if (!group) return <Fragment key={`ungrouped-${sectionIndex}`}>{rowElements}</Fragment>

      return (
        <div
          key={`group-${group.id}`}
          className={cn(
            'relative mt-1.5 first:mt-0',
            // The fill is a real BACKGROUND on the section, not part of the
            // overlay below: `bg-primary-100` is opaque, and an absolutely
            // positioned overlay paints above statically positioned children —
            // it would hide the header and rows it is meant to be highlighting.
            highlight?.groupId === group.id &&
              (highlight.blocked ? 'rounded-md bg-primary-100' : 'rounded-md bg-primary/10')
          )}>
          {isEditMode && (
            <>
              <FieldDropZone id={groupBeforeDropId(group.id)} edge='top' />
              <FieldDropZone id={groupAfterDropId(group.id)} edge='bottom' />
              {highlight?.groupId === group.id && (
                <div className='pointer-events-none absolute inset-0 z-10 rounded-md border border-primary-200 border-dashed' />
              )}
              {lineForGroup(group.id, 'top') && <FieldInsertLine side='top' />}
              {lineForGroup(group.id, 'bottom') && (
                <FieldInsertLine side='bottom' inset={indicator?.inset ?? false} />
              )}
            </>
          )}
          {renderGroupHeader(group, section.fieldIds.length, group.id === newGroupId)}
          {rowElements}
        </div>
      )
    })

  return (
    <>
      {/* Confirm delete dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for creating/editing fields */}
      {dialogOpen && (
        <CustomFieldDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          resourceFieldId={editingResourceFieldId}
          entityDefinitionId={entityDefinitionId}
          onSuccess={onMutationSuccess}
        />
      )}

      {/* Styled card container with keyboard navigation */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'group/entity-card bg-primary-100/50 dark:bg-[#23272e]/50 dark:border rounded-2xl relative outline-none focus:outline-none',
          'ring-border-illustration shadow-black/6.5 shadow-md ring-1',
          className
        )}>
        <div className='flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col'>
          {/* Edit mode header */}
          {canEdit && (
            <div
              className={cn(
                'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
                isEditMode ? 'opacity-100' : 'opacity-0 group-hover/entity-card:opacity-100'
              )}>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => (isEditMode ? void onExitEditMode() : onEnterEditMode())}
                className={cn(
                  'cursor-pointer',
                  isEditMode
                    ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {isEditMode ? <X /> : <Pencil />}
              </Button>
            </div>
          )}

          {/* Reordering is edit-mode only, so the DnD context only exists there */}
          {isEditMode ? (
            <DndContext
              // An empty sensor list is how a drag is made unreachable without
              // tearing the context out from under the rows (the KB sidebar's
              // pattern). Edit mode is already gated on `canEdit`; this keeps
              // the two from drifting.
              sensors={canEdit ? sensors : []}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={routeDragEnd}
              onDragCancel={() => {
                setActiveDragId(null)
                setDropTarget(null)
              }}
              modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
              {/* No `SortableContext`: nothing displaces, and the landing slot
                  is stated by an insert line plus a whole-group highlight. */}
              {renderSections()}

              {/* The ghost under the cursor. Without a `SortableContext` the
                  rows get no transform of their own, so the source only fades —
                  this is the piece that actually follows the pointer.

                  An earlier attempt at this DID break the list, but that failure
                  was `verticalListSortingStrategy` displacing every row by the
                  overlay's height while the source was still in flow. There is
                  no strategy now, so an overlay cannot move anything. */}
              {/* PORTALLED TO `document.body` ON PURPOSE. `DragOverlay` is
                  `position: fixed`, and fixed resolves against the nearest
                  ancestor with a `transform` / `filter` / `will-change` — not the
                  viewport. The record drawer animates in with a transform, so
                  rendering the overlay in place anchored it to the DRAWER and the
                  ghost sat ~200px below the cursor while the insert line (which
                  is absolutely positioned inside the list, so unaffected) stayed
                  correct. The portal takes the overlay out of that containing
                  block. */}
              {typeof document !== 'undefined' &&
                createPortal(
                  <DragOverlay
                    dropAnimation={null}
                    // dnd-kit sizes the overlay from the ACTIVE node's rect — for
                    // a group that is only the header, so a block preview has to
                    // be free to grow past it. The anchor stays the header's top
                    // edge, which is where the grab happened.
                    // dnd-kit hard-sets width AND height from the ACTIVE node's rect —
                    // a full-panel-width row. Releasing both lets the ghost shrink to
                    // its own content (icon + name), which is all it needs to say.
                    style={{ height: 'auto', width: 'auto' }}
                    className='pointer-events-none'>
                    {activeGroupSection ? (
                      // Semi-transparent so the insert line stays readable through
                      // the ghost — the line marks the landing slot and the ghost
                      // is only "what is in hand", so the line has to win.
                      //
                      // `pe-2`: the overlay's width is released to `auto`, so an
                      // EMPTY group shrinks to icon + title + member count with
                      // the count pressed against the ring. Members give the
                      // ghost its own width and never need it.
                      <div className='rounded-md bg-background/90 pe-2 opacity-90 shadow-lg ring-1 ring-border'>
                        {renderGroupHeader(
                          activeGroupSection.group as FieldGroupLike,
                          activeGroupSection.fieldIds.length,
                          false,
                          true
                        )}
                        {memberRowsOf(activeGroupSection.fieldIds).map((row) =>
                          renderMemberRow(row, { grouped: true, preview: true })
                        )}
                      </div>
                    ) : activeFieldRow ? (
                      // Semi-transparent so the insert line stays readable through
                      // the ghost — the line marks the landing slot and the ghost
                      // is only "what is in hand", so the line has to win.
                      <div className='rounded-md bg-background/90 opacity-90 shadow-lg ring-1 ring-border'>
                        {renderMemberRow(activeFieldRow, {
                          grouped: groupIdByFieldId.has(activeFieldRow.id),
                          preview: true,
                        })}
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body
                )}
            </DndContext>
          ) : (
            renderSections()
          )}

          {/* Add Field / Add Group — edit mode only, same permission gate */}
          {isEditMode && canEdit && (
            <>
              <AddFieldRow onClick={handleAddField} />
              {onAddGroup && <AddGroupRow onClick={handleAddGroup} />}
            </>
          )}

          {/* Draft footer — the drawer has no DialogFooter, so Save/Cancel live
              inside the card. Order and visibility are buffered locally until
              Save View writes them as one config update. */}
          {isEditMode && canEdit && (
            <div className='mt-2 flex items-center justify-end gap-2 border-border/60 border-t pt-2'>
              <Button size='sm' variant='ghost' onClick={onCancelEditMode} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void onSaveView()}
                loading={isSaving}
                loadingText='Saving...'>
                Save View
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
