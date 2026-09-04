// apps/web/src/components/records/layout-editor/rows/layout-tab-row.tsx
'use client'

import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow, TreeRowButton, TreeRowGrip } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { memo, type ReactNode, useState } from 'react'
import { groupDropId } from '~/components/grouped-drag-list/drop-targets'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
import type { EditorTab } from '../editor-state'
import { tabContentSummary } from '../editor-tree'

/** Fallback when a created tab's label is cleared to whitespace. */
const UNTITLED_TAB_LABEL = 'Untitled tab'

export interface LayoutTabRowProps {
  tab: EditorTab
  /** Sections placed on this tab. */
  sectionCount: number
  /** Whether the tab is shown in the strip. */
  visible: boolean
  /** The visibility switch is locked on (Overview, or the last visible tab). */
  locked: boolean
  /** Whether the viewer may write the ORG scope, i.e. create and place sections. */
  canAdministerDef: boolean
  /** Rendered inside the drag ghost: no controls, no inputs, no autofocus. */
  preview?: boolean
  /** Focus the label of a tab that was just created. */
  autoFocusLabel?: boolean
  onToggleVisible: () => void
  onRename: (label: string) => void
  onChangeIcon: (icon: string) => void
  onDelete: () => void
  /** Open or close this tab's "Add section" popover. */
  onAddSectionOpenChange: (open: boolean) => void
  /** Whether this tab's "Add section" popover is open. */
  addSectionOpen: boolean
  /** The popover body, supplied by the tree so this row stays presentational. */
  addSectionMenu?: ReactNode
}

/**
 * A tab, rendered as the `TreeRow` whose children are its sections (§9.1).
 *
 * The header is ONE `useSortable` registration under `groupDropId(tab.id)`, not
 * a draggable plus a separate droppable: `useSortable` already registers a
 * droppable under the same id, and `GroupedDragList` requires that single
 * registration because the header is simultaneously the drag SOURCE for moving
 * the whole tab and the drop TARGET that makes a section join it.
 *
 * The two scopes are visible in the controls this row carries, not just in the
 * footer (§9.5). The switch is PERSONAL: every member has had per-user tab
 * hiding via localStorage and keeps it: while "Add section", the icon, the
 * label and delete are ORG, and are absent rather than inert for a member who
 * cannot write that layer.
 */
export const LayoutTabRow = memo(function LayoutTabRow({
  tab,
  sectionCount,
  visible,
  locked,
  canAdministerDef,
  preview = false,
  autoFocusLabel = false,
  onToggleVisible,
  onRename,
  onChangeIcon,
  onDelete,
  onAddSectionOpenChange,
  addSectionOpen,
  addSectionMenu,
}: LayoutTabRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: groupDropId(tab.id),
    disabled: preview,
  })

  // CONTROLLED, and it has to be. `IconPicker` puts its `PopoverTrigger asChild`
  // on whatever child it is given, and `TreeRowButton` calls `stopPropagation()`
  // before its own `onClick` so a row action can never trigger the row. That
  // stop also kills the bubble the trigger was listening for, so an uncontrolled
  // picker simply never opened. Driving `open` ourselves is the same shape the
  // "Add section" popover on this row already uses.
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const Icon = resolveLayoutIcon(tab.icon) ?? Layers
  const editable = canAdministerDef && tab.isCreated && !preview

  const contentSummary = tabContentSummary(tab, sectionCount)

  // The grip takes the LEADING slot and cross-fades over the tab's icon, the
  // same hover swap every other draggable TreeRow in the app uses.
  //
  // That slot can hold one thing, so an editable tab's icon PICKER cannot also
  // live here: on hover the grip covers it and it stops being clickable. The
  // picker therefore moved into the actions cluster, where the tab's other
  // org-scope controls already are. Reordering is the frequent gesture and the
  // one that has to look the same everywhere; changing an icon is rare and
  // reads fine as an explicit button.
  const icon = (
    <span className='relative flex size-6 shrink-0 items-center justify-center'>
      {preview ? (
        <Icon className='size-4 text-neutral-400' />
      ) : (
        <TreeRowGrip
          icon={<Icon className='size-4 text-neutral-400' />}
          handleProps={{ ...attributes, ...listeners, 'aria-label': `Reorder ${tab.label}` }}
          isDragging={isDragging}
        />
      )}
    </span>
  )

  return (
    <div
      ref={setNodeRef}
      data-slot='layout-tab-row'
      className={cn('w-full', isDragging && 'opacity-30')}>
      <TreeRow
        icon={icon}
        rowClassName='bg-primary-50 hover:bg-primary-100'
        title={
          editable ? (
            <AutosizeInput
              value={tab.label}
              onChange={(event) => onRename(event.target.value)}
              onBlur={() => {
                if (!tab.label.trim()) onRename(UNTITLED_TAB_LABEL)
              }}
              onClick={(event) => event.stopPropagation()}
              autoFocus={autoFocusLabel}
              placeholder={UNTITLED_TAB_LABEL}
              minWidth={60}
              maxWidth={180}
              aria-label='Tab name'
              inputClassName='cursor-text border-0 bg-transparent p-0 font-medium text-foreground text-sm outline-none'
            />
          ) : (
            <span className='font-medium text-sm'>{tab.label}</span>
          )
        }
        secondary={
          preview ? undefined : (
            <span className='text-neutral-400 text-xs tabular-nums'>{contentSummary}</span>
          )
        }
        actions={
          preview ? undefined : (
            <div className='flex items-center gap-1'>
              {canAdministerDef && !tab.isBaseTab && (
                <Popover open={addSectionOpen} onOpenChange={onAddSectionOpenChange} modal={false}>
                  {/* The anchor is a wrapper span rather than the button
                      itself: `TreeRowButton` is a plain function component with
                      no ref forwarding, so `asChild` on the button would leave
                      Radix without an element to position against. */}
                  <PopoverAnchor asChild>
                    <span className='flex items-center'>
                      <TreeRowButton
                        tooltipText='Add a section to this tab (applies to everyone)'
                        aria-label={`Add a section to ${tab.label}`}
                        onClick={() => onAddSectionOpenChange(!addSectionOpen)}>
                        <Plus />
                      </TreeRowButton>
                    </span>
                  </PopoverAnchor>
                  <PopoverContentDialogAware className='w-80 p-0' align='end'>
                    {addSectionMenu}
                  </PopoverContentDialogAware>
                </Popover>
              )}
              {canAdministerDef && tab.isCreated && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Delete this tab (applies to everyone)'
                  aria-label={`Delete ${tab.label}`}
                  onClick={onDelete}>
                  <Trash2 />
                </TreeRowButton>
              )}
              {editable && (
                // A layout stores an icon NAME and nothing else, so the colour
                // half of the picker has nowhere to go and is hidden rather
                // than silently discarded. `modal={false}` is what keeps the
                // popover usable inside the dialog.
                <IconPicker
                  value={{ icon: tab.icon ?? 'folder', color: 'gray' }}
                  onChange={(value) => {
                    onChangeIcon(value.icon)
                    setIconPickerOpen(false)
                  }}
                  align='end'
                  modal={false}
                  hideColors
                  open={iconPickerOpen}
                  onOpenChange={setIconPickerOpen}>
                  <span className='flex items-center'>
                    <TreeRowButton
                      tooltipText="Change this tab's icon (applies to everyone)"
                      aria-label={`Change the ${tab.label} icon`}
                      onClick={() => setIconPickerOpen(!iconPickerOpen)}>
                      <Icon />
                    </TreeRowButton>
                  </span>
                </IconPicker>
              )}
              <Switch
                size='xs'
                checked={visible}
                disabled={locked}
                aria-label={`Show ${tab.label} tab`}
                onCheckedChange={onToggleVisible}
              />
            </div>
          )
        }
      />
    </div>
  )
})
