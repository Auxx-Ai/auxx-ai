// apps/web/src/components/fields/ui/field-group-list.tsx
'use client'

import type { FieldGroup } from '@auxx/lib/conditions/client'
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
import { Fragment, type ReactNode, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type FieldGroupLike, type GroupedFieldSection, groupFieldOrder } from '../group-fields'
import { FieldGroupRow, parseGroupDropId } from '../rows/field-group-row'
import {
  type FieldDropTarget,
  FieldDropZone,
  FieldInsertLine,
  fieldBeforeDropId,
  groupAfterDropId,
  groupBeforeDropId,
  groupDropId,
  groupEndDropId,
  resolveDropTarget,
} from '../rows/field-insert-line'

/** What `renderRow` is told about the slot it is rendering into. */
export interface FieldGroupListRowContext {
  /** The row belongs to a group (the caller decides how to indent it). */
  grouped: boolean
  /** A member of the group currently in hand — fades with its header. */
  dimmed: boolean
  /** Rendered inside the drag ghost: no actions, no drop zones, no insert lines. */
  preview: boolean
  /**
   * The last row in the whole rendered list. Only the dialog needs it — see the
   * `rowBorders: 'managed'` variant on `FieldPanel`, whose direct-child last-row
   * rule cannot see across group wrappers.
   */
  isLast: boolean
  /**
   * Position in the VISIBLE rendered order (a collapsed group contributes no
   * rows). The property panel's keyboard navigation is indexed by this.
   */
  navIndex: number
}

export interface FieldGroupListProps<TRow> {
  /** Rows in `fieldOrder` order, already filtered to what should render. */
  rows: TRow[]
  /** The VIEW field id — the id `fieldOrder` / `fieldGroups[].fieldIds` store, and every dnd id. */
  rowId: (row: TRow) => string
  /** React key. Deliberately separate from `rowId`: the panel keys by `providerId`. */
  rowKey: (row: TRow) => string
  groups: FieldGroup[]
  isEditMode: boolean
  /** Gate on the surface's own permission — an empty sensor list disables dragging. */
  canEdit?: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  /**
   * Drop handler for a FIELD drag. `edge` names which side of the target the
   * field lands on, read from the pre-drag positions so the drop agrees with
   * the insert line.
   */
  onFieldDragEnd: (event: DragEndEvent, edge?: 'before' | 'after') => void
  /** Place a field immediately before/after a group's block, belonging to NO group. */
  onPlaceFieldBesideGroup?: (fieldId: string, groupId: string, side: 'before' | 'after') => void
  /** Move a whole group block. `overId` is a bare group id when `overIsGroup`, else a field id. */
  onMoveGroup?: (groupId: string, overId: string, overIsGroup: boolean) => void
  onRenameGroup?: (groupId: string, label: string) => void
  onDeleteGroup?: (groupId: string, label: string) => void
  /** Autofocus the label of a group that was just created. */
  newGroupId?: string | null
  /** Class applied to a GROUPED row's wrapper — the two surfaces indent differently. */
  groupedRowClassName?: string
  /**
   * Class applied to a group's section wrapper (and to the drag ghost, so the
   * two agree). This is where a surface re-aligns the header with its own rows,
   * through `FieldGroupRow`'s `data-slot`s — see the record dialog.
   */
  groupClassName?: string
  /**
   * Groups that cannot be collapsed right now (the dialog's validation errors).
   * A derived override, not an imperative expand: while a group holds an unfixed
   * error the user cannot collapse it, which is the intended reading of
   * "auto-expand on error" — clearing the override once would hide the error
   * again on the next click.
   */
  forceExpandGroupIds?: string[]
  renderRow: (row: TRow, ctx: FieldGroupListRowContext) => ReactNode
}

/**
 * The grouped field list and its whole drag model, shared by the property panel
 * drawer and the record create/edit dialog.
 *
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
 * dims to 0.3 and stays put. The `DragOverlay` below is what follows the
 * cursor.
 */
export function FieldGroupList<TRow>({
  rows,
  rowId,
  rowKey,
  groups,
  isEditMode,
  canEdit = true,
  sensors,
  onFieldDragEnd,
  onPlaceFieldBesideGroup,
  onMoveGroup,
  onRenameGroup,
  onDeleteGroup,
  newGroupId,
  groupedRowClassName = 'ps-3',
  groupClassName,
  forceExpandGroupIds,
  renderRow,
}: FieldGroupListProps<TRow>) {
  const rowById = new Map(rows.map((row) => [rowId(row), row]))

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

  const forceExpanded = new Set(forceExpandGroupIds ?? [])

  /**
   * Edit mode forces every group OPEN. You are rearranging structure there —
   * dragging fields between groups and groups past each other — and a hidden
   * block is a block you cannot drop into or see the result of. It also removes
   * the collapsed-group drop target, which was the main source of drop
   * ambiguity: with every member row visible, a drop always has a real row to
   * resolve against instead of a header standing in for hidden content.
   */
  const isGroupCollapsed = (group: FieldGroupLike): boolean => {
    if (isEditMode) return false
    if (forceExpanded.has(group.id)) return false
    return collapsedOverrides[group.id] ?? group.collapsed ?? false
  }

  const toggleGroupCollapsed = (group: FieldGroupLike) => {
    if (isEditMode) return
    setCollapsedOverrides((prev) => ({ ...prev, [group.id]: !isGroupCollapsed(group) }))
  }

  // Sections are derived from the ids that actually render, so exclusion filters
  // and hidden fields can never leave a group claiming a field the list doesn't
  // show. Empty groups only exist in edit mode, where they are drop targets;
  // read mode drops them entirely.
  const sections = groupFieldOrder({
    fieldOrder: rows.map(rowId),
    groups,
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
  const lastVisibleRowId = visibleRowIds[visibleRowIds.length - 1]

  // ─────────────────────────────────────────────────────────────────
  // DRAG MODEL — insert lines, not displacement
  // ─────────────────────────────────────────────────────────────────

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
      const overFieldId =
        dropTarget.kind === 'field' || dropTarget.kind === 'field-before'
          ? dropTarget.fieldId
          : null
      const referenceGroupId =
        overFieldId !== null
          ? (groupIdByFieldId.get(overFieldId) ?? null)
          : dropTarget.kind === 'field' || dropTarget.kind === 'field-before'
            ? null
            : dropTarget.groupId
      if (referenceGroupId === null) {
        const fieldId = overFieldId
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
      case 'field-before': {
        // Named boundary: always the row's top edge, never `edgeFor`.
        const targetGroupId = groupIdByFieldId.get(dropTarget.fieldId) ?? null
        return {
          indicator: { kind: 'row', rowId: dropTarget.fieldId, side: 'top', inset: false },
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
      case 'group-end': {
        // Full-width line under the last member, and the group lights up: this
        // lands INSIDE. The `group-after` zone directly below draws the short
        // inset line instead, so the two are told apart at a glance even though
        // they sit only a few pixels apart.
        const memberIds = memberIdsOfGroup(dropTarget.groupId).filter((id) => id !== activeDragId)
        const lastMemberId = memberIds[memberIds.length - 1]
        return {
          indicator:
            lastMemberId === undefined
              ? null
              : { kind: 'row', rowId: lastMemberId, side: 'bottom', inset: false },
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

  const lineForRow = (id: string, side: 'top' | 'bottom'): boolean =>
    indicator?.kind === 'row' && indicator.rowId === id && indicator.side === side

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
      /** The field in hand is already the last thing in that group's block. */
      const isLastMemberOf = (groupId: string): boolean => {
        const memberIds = sectionsRef.current.find((s) => s.group?.id === groupId)?.fieldIds ?? []
        return memberIds[memberIds.length - 1] === draggedId
      }

      const usable = collisions.filter((collision) => {
        const target = resolveDropTarget(String(collision.id))
        if (target.kind === 'field' || target.kind === 'field-before')
          return target.fieldId !== draggedId
        // "Inside, last slot" is where this field already IS — the drop would be
        // a no-op, and the zone would sit on top of the one target that isn't:
        // leaving the group downward.
        if (target.kind === 'group-end') return !isLastMemberOf(target.groupId)
        return true
      })

      // `group-end` wins outright wherever it is under the pointer.
      //
      // `pointerWithin` ranks by distance from the pointer to each droppable's
      // CENTRE, and this zone is a band inside the last member's row — so the
      // two centres are about a pixel apart and the winner flipped with a pixel
      // of pointer movement, which read as "the zone doesn't accept drops".
      // Sizing cannot fix that; only precedence can. It is safe because the
      // zone only overlaps that one row, and for a DOWNWARD drag both targets
      // resolve to the same slot anyway.
      const endIndex = usable.findIndex(
        (collision) => resolveDropTarget(String(collision.id)).kind === 'group-end'
      )
      if (endIndex > 0) {
        const promoted = usable[endIndex]
        usable.splice(endIndex, 1)
        if (promoted) usable.unshift(promoted)
      }

      return usable
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
      if (target.kind === 'field' || target.kind === 'field-before')
        return !ownMemberIds.has(target.fieldId)
      // `group-end` means "inside that group", which a group can never be. Left
      // in, it would only compete with the `group-after` zone beneath it for the
      // one thing a group drag CAN do at that boundary.
      if (target.kind === 'group-end') return false
      return target.groupId !== draggedGroupId && !emptyGroupIds.has(target.groupId)
    })
  }, [])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
    setDropTarget(null)
  }

  /** Identity of a drop target, so an unchanged hover does not re-render. */
  const dropTargetKey = (target: FieldDropTarget): string =>
    target.kind === 'field' || target.kind === 'field-before'
      ? `${target.kind}:${target.fieldId}`
      : `${target.kind}:${target.groupId}`

  const handleDragOver = (event: DragOverEvent) => {
    const next = event.over === null ? null : resolveDropTarget(String(event.over.id))
    setDropTarget((prev) => {
      if (prev === null || next === null) return prev === next ? prev : next
      return dropTargetKey(prev) === dropTargetKey(next) ? prev : next
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
      if (target.kind === 'field' || target.kind === 'field-before') {
        onMoveGroup?.(draggedGroupId, target.fieldId, false)
        return
      }
      if (target.groupId === draggedGroupId) return
      onMoveGroup?.(draggedGroupId, target.groupId, true)
      return
    }

    switch (target.kind) {
      case 'field-before':
        // The zone names the edge, so the drop does not consult the direction.
        if (target.fieldId === activeId) return
        onFieldDragEnd(aimedAt(event, target.fieldId), 'before')
        return
      case 'field': {
        if (target.fieldId === activeId) return
        // The SAME expression `deriveDropFeedback` draws the insert line from,
        // so the drop cannot land on a different edge than the line promised.
        // It must be read from the pre-drag positions in this render's closure —
        // `onFieldDragEnd` may relocate the field (joining a group appends it to
        // the block's tail) before it reorders, which would flip the direction.
        const side = edgeFor(orderIndexById.get(target.fieldId) ?? -1)
        onFieldDragEnd(aimedAt(event, target.fieldId), side === 'bottom' ? 'after' : 'before')
        return
      }
      case 'group-into':
        onFieldDragEnd(aimedAt(event, groupDropId(target.groupId)))
        return
      case 'group-end': {
        // Aim at the last member with an explicit `after`. `onFieldDragEnd`
        // reads membership from where the field lands, so targeting a member
        // both joins the group and settles at its end — and naming the edge is
        // the whole point: an upward drag would otherwise land before it.
        const memberIds = memberIdsOfGroup(target.groupId).filter((id) => id !== activeId)
        const lastMemberId = memberIds[memberIds.length - 1]
        if (lastMemberId === undefined) {
          onFieldDragEnd(aimedAt(event, groupDropId(target.groupId)))
          return
        }
        onFieldDragEnd(aimedAt(event, lastMemberId), 'after')
        return
      }
      case 'group-before':
        onPlaceFieldBesideGroup?.(activeId, target.groupId, 'before')
        return
      case 'group-after':
        onPlaceFieldBesideGroup?.(activeId, target.groupId, 'after')
        return
    }
  }

  /** A section's member rows, in the section's own order, ghosts skipped. */
  const memberRowsOf = (fieldIds: string[]): TRow[] =>
    fieldIds.flatMap((fieldId) => {
      const row = rowById.get(fieldId)
      return row === undefined ? [] : [row]
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
    row: TRow,
    options: { grouped: boolean; dimmed?: boolean; preview?: boolean }
  ) => {
    const id = rowId(row)
    return (
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
        key={rowKey(row)}
        className={cn(
          'relative',
          options.grouped && groupedRowClassName,
          options.dimmed && 'opacity-30'
        )}>
        {isEditMode && !options.preview && (
          <>
            <FieldDropZone id={fieldBeforeDropId(id)} edge='top' />
            {lineForRow(id, 'top') && <FieldInsertLine side='top' />}
            {lineForRow(id, 'bottom') && <FieldInsertLine side='bottom' />}
          </>
        )}
        {renderRow(row, {
          grouped: options.grouped,
          dimmed: options.dimmed ?? false,
          preview: options.preview ?? false,
          // A preview lives in the overlay, outside the panel — it must never
          // claim the managed last-row border.
          isLast: !options.preview && id === lastVisibleRowId,
          navIndex: navIndexById.get(id) ?? 0,
        })}
      </div>
    )
  }

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
            groupClassName,
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
              {/* Only when the block HAS a last member to land after. On an
                  empty group this band would sit over the header, where
                  `group-into` already means the same thing. */}
              {memberRows.length > 0 && (
                <FieldDropZone id={groupEndDropId(group.id)} edge='inner-bottom' />
              )}
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

  // Reordering is edit-mode only, so the DnD context only exists there.
  if (!isEditMode) return <>{renderSections()}</>

  return (
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
          viewport. The record drawer animates in with a transform (and Radix
          `DialogContent` centres with one), so rendering the overlay in place
          anchored it to the DRAWER and the ghost sat ~200px below the cursor
          while the insert line (which is absolutely positioned inside the list,
          so unaffected) stayed correct. The portal takes the overlay out of that
          containing block. */}
      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay
            dropAnimation={null}
            // dnd-kit hard-sets width AND height from the ACTIVE node's rect —
            // for a group that is only the header, so a block preview has to be
            // free to grow past it, and a row ghost would otherwise be a
            // full-panel-width bar. Releasing both lets the ghost shrink to its
            // own content (icon + name), which is all it needs to say. The
            // anchor stays the active node's top edge, where the grab happened.
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
              <div
                className={cn(
                  'rounded-md bg-background/90 pe-2 opacity-90 shadow-lg ring-1 ring-border',
                  groupClassName
                )}>
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
            ) : activeFieldRow !== undefined ? (
              <div className='rounded-md bg-background/90 opacity-90 shadow-lg ring-1 ring-border'>
                {renderMemberRow(activeFieldRow, {
                  grouped: groupIdByFieldId.has(rowId(activeFieldRow)),
                  preview: true,
                })}
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  )
}
