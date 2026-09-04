// apps/web/src/components/fields/rows/field-group-row.tsx
'use client'

import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, FolderPlus, GripVertical, Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import { groupDropId } from '~/components/grouped-drag-list/drop-targets'
import type { FieldGroupLike } from '../group-fields'

/**
 * Re-exported so the field panel's drag glue keeps one import site for the
 * group id keyspace. The keyspace itself is owned by the generic grouped list,
 * since every producer and consumer of these ids has to agree on one prefix.
 */
export { GROUP_DROP_PREFIX, parseGroupDropId } from '~/components/grouped-drag-list/drop-targets'

interface FieldGroupRowProps {
  /** Only identity and header chrome are read; the list owns membership and position. */
  group: Pick<FieldGroupLike, 'id' | 'label' | 'icon'>
  /** Whether the group's members are hidden right now. */
  collapsed: boolean
  /** Number of member rows this group would render when expanded. */
  memberCount: number
  onToggleCollapsed: () => void
  /**
   * Edit mode adds the drag handle and registers the header in the sortable
   * context. Read mode renders the same header without either.
   */
  isEditMode?: boolean
  /** Edit mode only — renames the group in the draft on every keystroke. */
  onRename?: (label: string) => void
  /** Edit mode only — the caller confirms before calling this. */
  onDelete?: () => void
  /** Focus the label input on mount (a group that was just created). */
  autoFocusLabel?: boolean
}

/** Fallback when a group's label is cleared to whitespace. */
const UNTITLED_GROUP_LABEL = 'Untitled group'

/**
 * Group header row in the property panel.
 *
 * A group has no stored position — this header renders wherever the group's
 * FIRST member sits in `fieldOrder` (see `group-fields.ts`). Dragging the header
 * moves the group's whole member block through `moveGroupBlock`, which rewrites
 * the order so the block lands at the drop point as one unit; a COLLAPSED group
 * drags exactly the same way, which is the point of the handle.
 *
 * The header is ONE `useSortable` registration, not a draggable plus a separate
 * droppable: `useSortable` already registers a droppable under the same id, so a
 * second `useDroppable` would double-register it. That single registration is
 * live for every drag, so a FIELD dropped on the header joins the group (the
 * drag-end router decides that from what is being dragged) whether or not the
 * block has member rows of its own.
 *
 * Read mode is a single toggle: chevron + label + member count. Edit mode adds
 * the grip, swaps the label for an inline {@link AutosizeInput}, and adds a
 * delete button. Renaming is inline rather than a dialog because building a
 * group is already a multi-step draft flow (create → name → drag fields in →
 * collapse) and a modal over the drawer would interrupt it for a single text
 * field; this is the same click-to-rename shape the tree rows use
 * (ui-design-guide §7/§17).
 */
export const FieldGroupRow = memo(function FieldGroupRow({
  group,
  collapsed,
  memberCount,
  onToggleCollapsed,
  isEditMode = false,
  onRename,
  onDelete,
  autoFocusLabel = false,
}: FieldGroupRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupDropId(group.id),
    disabled: !isEditMode,
  })

  // Fades in place, exactly like `FieldEditRow` — no `SortableContext`, so no
  // transform and no displacement. The header's own `isOver` ring is gone: the
  // section wrapper in `entity-fields-content` now draws ONE dashed highlight
  // across the header AND its members, so a group being targeted lights up as
  // the single unit it moves as.
  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 10 : 1,
      opacity: isDragging ? 0.3 : 1,
    }),
    [transform, transition, isDragging]
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-slot='field-group-row'
      // The section wrapper owns this header's top margin now — it wraps the
      // header AND its members, so `first:mt-0` has to be measured against the
      // panel's children, not against the inside of that wrapper.
      className='group/field-group-row flex h-fit min-h-[30px] w-full items-center gap-1 rounded-md'>
      {/* Leading band — grip/chevron AND label together, `self-start` in a fixed
          24px band. `FieldEditRow` bands its grip + field name the same way, so
          the row is 30px tall but its text sits at the top. Leaving the label as
          a sibling centred by the row's `items-center` dropped group titles a few
          px below the field names beneath them.
          A surface whose rows centre theirs instead (the record dialog's
          `FieldPanelRow`s) overrides through `data-slot`. */}
      <div
        data-slot='field-group-band'
        className='flex h-[24px] min-w-0 flex-1 items-center gap-[4px] self-start'>
        {isEditMode ? (
          /* Icon by default, grip cross-fading in on row hover or while dragging
             — the same swap `TreeRow` and `FieldEditRow` use, so a group header
             reads like the rows it contains. */
          <span
            data-slot='field-group-glyph'
            className='relative flex size-6 shrink-0 items-center justify-center'>
            <span
              className={cn(
                'flex items-center justify-center opacity-0 transition-opacity pointer-fine:opacity-100',
                isDragging
                  ? 'pointer-fine:opacity-0'
                  : 'pointer-fine:group-hover/field-group-row:opacity-0'
              )}>
              <EntityIcon
                iconId={group.icon ?? 'folder'}
                variant='default'
                size='default'
                className='text-neutral-400'
              />
            </span>
            <span
              {...attributes}
              {...listeners}
              aria-label={`Reorder group ${group.label}`}
              // Carries the glyph slot too: `inset-0` resolves against the
              // PADDING box, so an override that insets the icon layer above
              // would leave the grip centred and the two would cross-fade
              // between different x positions.
              data-slot='field-group-glyph'
              className={cn(
                'absolute inset-0 flex cursor-grab touch-none items-center justify-center opacity-100 transition-opacity pointer-fine:opacity-0 active:cursor-grabbing',
                isDragging
                  ? 'pointer-fine:opacity-100'
                  : 'pointer-fine:group-hover/field-group-row:opacity-100'
              )}>
              <GripVertical className='size-4 shrink-0 text-neutral-400' />
            </span>
          </span>
        ) : (
          /* Edit mode has no chevron: every group is forced open there, so a
             disclosure control would be a no-op next to the drag handle.
             Collapsing is a read-mode reading affordance, not a structural edit. */
          <button
            type='button'
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
            onClick={onToggleCollapsed}
            data-slot='field-group-glyph'
            className='flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-primary-200/60'>
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-neutral-400 transition-transform duration-150',
                !collapsed && 'rotate-90'
              )}
            />
          </button>
        )}

        {onRename ? (
          <>
            <AutosizeInput
              value={group.label}
              onChange={(e) => onRename(e.target.value)}
              onBlur={() => {
                if (!group.label.trim()) onRename(UNTITLED_GROUP_LABEL)
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus={autoFocusLabel}
              placeholder={UNTITLED_GROUP_LABEL}
              minWidth={60}
              maxWidth={150}
              aria-label='Group name'
              // The wrapper sets `display: inline-block` as an inline style, so
              // it cannot be flexed from here — the band centres it instead.
              // `border-0 p-0` strips the browser's default input chrome, which
              // is what pushed the label off the field-name baseline; the
              // matching line-height keeps it on the band.
              inputClassName='border-0 bg-transparent p-0 font-medium text-neutral-500 text-sm leading-[24px] outline-none'
            />
            <span className='shrink-0 text-neutral-400 text-xs tabular-nums'>{memberCount}</span>
          </>
        ) : (
          <button
            type='button'
            onClick={onToggleCollapsed}
            className='flex min-w-0 cursor-pointer items-center gap-1.5 rounded text-left transition-colors hover:bg-primary-200/40'>
            <span className='truncate font-medium text-neutral-500 text-sm'>{group.label}</span>
            <span className='shrink-0 text-neutral-400 text-xs tabular-nums'>{memberCount}</span>
          </button>
        )}
      </div>

      {onDelete && (
        /* Trailing actions, flush right by default — the panel's rows are too.
           A surface whose rows keep a right gutter (the dialog's `pe-2` content
           area) adds one through this slot. */
        <div data-slot='field-group-actions' className='flex shrink-0 items-center'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Delete group ${group.label}`}
            className='text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  )
})

interface AddGroupRowProps {
  onClick: () => void
  /** Spacing/alignment for the surface it sits under (the panel needs none). */
  className?: string
}

/**
 * Edit-mode affordance that creates a new (empty) group, mirroring `AddFieldRow`'s
 * shape so the two read as one pair of actions.
 */
export function AddGroupRow({ onClick, className }: AddGroupRowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        '-ms-1 row group flex h-[24px] min-h-[30px] cursor-pointer items-center gap-1 rounded-md transition-colors hover:bg-primary-200/50',
        className
      )}>
      <div className='flex h-[24px] shrink-0 items-center gap-[4px] ps-1.5 text-primary-500'>
        <FolderPlus className='size-4 shrink-0' />
        <div className='w-[120px] shrink-0 text-sm'>
          <div className='truncate'>Add Group</div>
        </div>
      </div>
    </div>
  )
}
