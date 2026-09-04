// apps/web/src/components/fields/ui/field-group-list.tsx
'use client'

import type { DragEndEvent, SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import { type ReactNode, useMemo } from 'react'
import {
  GroupedDragList,
  type GroupedDragListGroup,
  type GroupedDragListRowContext,
} from '~/components/grouped-drag-list/grouped-drag-list'
import type { FieldGroupLike } from '../group-fields'
import { FieldGroupRow } from '../rows/field-group-row'

/**
 * What `renderRow` is told about the slot it is rendering into.
 *
 * The generic list's context under the field panel's name, so the two surfaces
 * that consume it keep importing it from here.
 */
export type FieldGroupListRowContext = GroupedDragListRowContext

/** A `FieldGroup` in the generic list's vocabulary — see {@link toListGroups}. */
interface FieldListGroup extends GroupedDragListGroup {
  label: string
  icon?: string
}

/**
 * Adapt the persisted field-view group shape to the grouped list's contract.
 *
 * `FieldGroup` is a stored zod schema with rows in production, so it names its
 * members `fieldIds` and its empty-group anchor `anchorFieldId` and always will.
 * The generic list speaks `itemIds` / `anchorItemId`, and this one map is the
 * whole of the difference. Memoised by the caller, so a header row's `memo`
 * still holds across renders that do not touch the groups.
 */
function toListGroups(groups: FieldGroupLike[]): FieldListGroup[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.icon,
    collapsed: group.collapsed,
    itemIds: group.fieldIds,
    anchorItemId: group.anchorFieldId,
  }))
}

export interface FieldGroupListProps<TRow> {
  /** Rows in `fieldOrder` order, already filtered to what should render. */
  rows: TRow[]
  /** The VIEW field id — the id `fieldOrder` / `fieldGroups[].fieldIds` store, and every dnd id. */
  rowId: (row: TRow) => string
  /** React key. Deliberately separate from `rowId`: the panel keys by `providerId`. */
  rowKey: (row: TRow) => string
  groups: FieldGroupLike[]
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
 * The grouped field list, shared by the property panel drawer and the record
 * create/edit dialog.
 *
 * The drag model itself lives in {@link GroupedDragList}, which is generic over
 * its item and group types. This is the field panel's boundary onto it, and it
 * owns exactly two field-specific things:
 *
 * 1. **The group shape.** `FieldGroup` is persisted, so `fieldIds` /
 *    `anchorFieldId` cannot be renamed; {@link toListGroups} maps them.
 * 2. **The group header.** `FieldGroupRow` is shaped for this panel (its
 *    `data-slot`s are what the record dialog re-aligns through), and rename,
 *    delete and new-group autofocus are its chrome, not the list's.
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
  groupedRowClassName,
  groupClassName,
  forceExpandGroupIds,
  renderRow,
}: FieldGroupListProps<TRow>) {
  const listGroups = useMemo(() => toListGroups(groups), [groups])

  return (
    <GroupedDragList<TRow, FieldListGroup>
      rows={rows}
      rowId={rowId}
      rowKey={rowKey}
      groups={listGroups}
      isEditMode={isEditMode}
      canEdit={canEdit}
      sensors={sensors}
      onItemDragEnd={onFieldDragEnd}
      onPlaceItemBesideGroup={onPlaceFieldBesideGroup}
      onMoveGroup={onMoveGroup}
      groupedRowClassName={groupedRowClassName}
      groupClassName={groupClassName}
      forceExpandGroupIds={forceExpandGroupIds}
      renderRow={renderRow}
      renderGroupHeader={(group, ctx) => (
        <FieldGroupRow
          group={group}
          collapsed={ctx.collapsed}
          memberCount={ctx.memberCount}
          onToggleCollapsed={ctx.onToggleCollapsed}
          isEditMode={ctx.isEditMode}
          // The ghost is a picture of what is in hand, not a live row: no rename
          // input to focus, no delete button to hit. Withholding the handlers is
          // what collapses it to icon + title, since the trailing actions only
          // render when their handler exists.
          onRename={
            !ctx.preview && ctx.isEditMode && onRenameGroup
              ? (label) => onRenameGroup(group.id, label)
              : undefined
          }
          onDelete={
            !ctx.preview && ctx.isEditMode && onDeleteGroup
              ? () => onDeleteGroup(group.id, group.label)
              : undefined
          }
          autoFocusLabel={!ctx.preview && group.id === newGroupId}
        />
      )}
    />
  )
}
