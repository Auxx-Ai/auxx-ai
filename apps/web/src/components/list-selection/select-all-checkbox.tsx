// apps/web/src/components/list-selection/select-all-checkbox.tsx

'use client'

import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import { useId } from 'react'
import { useListSelection, useSelectionIds } from './store'

/**
 * Row one of a `ListToolbar` is 48px: a `size='sm'` `RadioTab` (`h-8`) inside
 * the bar's `py-2`. The box is square, so this is its width too.
 */
const BOX_PX = 48

/**
 * A `TreeRow`'s checkbox centre, measured from the start of the list's padding:
 * the row's own `px-1` plus half its `size-7` leading slot.
 */
const ROW_CHECKBOX_INSET_PX = 4 + 14

/** Where a `ListToolbarGroup` starts inside the bar - `ListToolbar`'s `px-3`. */
const TOOLBAR_INSET_PX = 12

interface SelectAllCheckboxProps {
  /** The list container's own padding, in px - `p-3` is 12, `p-4` is 16. */
  listPadding: number
  /** Force the disabled look on a list that cannot be selected at all. */
  disabled?: boolean
  className?: string
}

/**
 * Select-all for a `ListSelectionProvider` list, as the first control in a
 * `ListToolbar` row.
 *
 * 🛑 It aligns with the rows' OWN checkboxes, which is the whole point of the
 * offset: `listPadding + 4 + 14` is where a `TreeRow` puts its box, the bar's
 * groups start 12px in, and a 48px square centres 24px into itself - so
 * `marginLeft = listPadding - 18`. Both halves have to be re-derived if the
 * tabs change size or the list changes padding.
 *
 * 🛑 DISABLED on an empty list, never absent. It is the first thing in the bar,
 * and dropping it shifts every filter beside it sideways the moment somebody
 * lands on a tab with nothing in it.
 */
export function SelectAllCheckbox({
  listPadding,
  disabled = false,
  className,
}: SelectAllCheckboxProps) {
  const id = useId()
  const selectedIds = useSelectionIds()
  const itemIds = useListSelection((state) => state.itemIds)
  const selectAll = useListSelection((state) => state.selectAll)
  const clear = useListSelection((state) => state.clear)

  const empty = disabled || itemIds.length === 0
  const anySelected = selectedIds.length > 0
  // The store prunes the selection to `itemIds`, so "all" can only ever mean
  // the rows currently listed.
  const checked: boolean | 'indeterminate' = !anySelected
    ? false
    : selectedIds.length >= itemIds.length
      ? true
      : 'indeterminate'

  return (
    <label
      htmlFor={id}
      style={{
        marginLeft: `${listPadding - TOOLBAR_INSET_PX - BOX_PX / 2 + ROW_CHECKBOX_INSET_PX}px`,
      }}
      className={cn(
        '-my-2 flex size-12 shrink-0 items-center justify-center',
        empty ? 'cursor-default' : 'cursor-pointer',
        className
      )}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={empty}
        aria-label={anySelected ? 'Clear the selection' : 'Select everything listed'}
        onCheckedChange={() => (anySelected ? clear() : selectAll())}
      />
    </label>
  )
}
