// apps/web/src/components/print/ui/print-column-picker.tsx

'use client'

import type { PrintStyle } from '@auxx/lib/export/client'
import {
  Command,
  CommandCheckboxItem,
  CommandDescription,
  CommandGroup,
  CommandList,
  CommandSeparator,
  CommandSortable,
  CommandSortableItem,
} from '@auxx/ui/components/command'
import { X } from 'lucide-react'
import { columnKey, type UsePrintColumnsResult } from '../hooks/use-print-columns'

interface PrintColumnPickerProps {
  columns: UsePrintColumnsResult
  /** List calls the picked entries "Columns"; detail calls the exact same entries "Fields"
   * (the label/value blocks on each record's sheet) — same picker, different word. */
  style: PrintStyle
}

/**
 * Print wizard "Content" page — the column/field picker `usePrintColumns` drives, reused
 * as-is by both the `list` style (table columns) and the `detail` style (label/value field
 * blocks) since the underlying selection semantics are identical (`viewColumns` preselected,
 * `allColumns` addable, drag to reorder). Selected entries are drag-reorderable
 * (`CommandSortable`), removable; the remaining pool is addable via a checkbox. Mirrors
 * `column-manager.tsx`'s sortable-list idiom.
 */
export function PrintColumnPicker({ columns, style }: PrintColumnPickerProps) {
  const { selected, available, addColumn, removeColumn, reorder } = columns
  const noun = style === 'detail' ? 'Fields' : 'Columns'

  return (
    <Command shouldFilter={false} className='p-0'>
      <CommandList scrollAreaClassName='max-h-[360px]'>
        <CommandGroup heading={`${noun} (${selected.length})`}>
          {selected.length === 0 ? (
            <CommandDescription>
              No {noun.toLowerCase()} selected — add at least one below.
            </CommandDescription>
          ) : (
            <CommandSortable items={selected.map(columnKey)} onReorder={reorder}>
              {selected.map((column) => (
                <CommandSortableItem
                  key={columnKey(column)}
                  id={columnKey(column)}
                  className='py-0 pe-0.5'>
                  <span className='min-w-0 flex-1 truncate'>{column.label}</span>
                  <button
                    type='button'
                    aria-label={`Remove ${column.label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeColumn(column)
                    }}
                    className='flex size-6.5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent'>
                    <X className='size-3.5' />
                  </button>
                </CommandSortableItem>
              ))}
            </CommandSortable>
          )}
        </CommandGroup>

        {available.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Add ${style === 'detail' ? 'field' : 'column'}`}>
              {available.map((column) => (
                <CommandCheckboxItem
                  key={columnKey(column)}
                  checked={false}
                  onCheckedChange={() => addColumn(column)}>
                  <span className='min-w-0 flex-1 truncate'>{column.label}</span>
                </CommandCheckboxItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}
