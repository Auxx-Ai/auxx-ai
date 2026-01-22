// apps/web/src/components/dynamic-table/components/header-cell-wrapper.tsx

'use client'

import { type Header } from '@tanstack/react-table'
import { cn } from '@auxx/ui/lib/utils'
import { HeaderCell } from './header-cell'
import type { ExtendedColumnDef } from '../types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { sanitizeColumnId } from '../utils/sanitize-column-id'

interface HeaderCellWrapperProps<TData> {
  header: Header<TData, unknown>
}

/**
 * Header cell wrapper with column resizing and drag logic
 */
export function HeaderCellWrapper<TData>({ header }: HeaderCellWrapperProps<TData>) {
  const columnDef = header.column.columnDef as ExtendedColumnDef
  const isCheckboxColumn = header.column.id === '_checkbox'

  // Drag and drop functionality (disabled for checkbox column)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
    disabled: isCheckboxColumn,
  })

  // Drag transform style (separate from width which uses CSS variables)
  const dragStyle = transform ? { transform: CSS.Transform.toString(transform), transition } : {}

  return (
    <div
      ref={setNodeRef}
      data-col={sanitizeColumnId(header.column.id)}
      style={{
        ...dragStyle,
        minWidth: columnDef.minSize,
        maxWidth: columnDef.maxSize,
      }}
      className={cn('relative shrink-0 border-t', isDragging && 'opacity-30 z-50')}>
      <div
        className="group min-w-min py-2 h-full font-inter font-medium w-full"
        {...(!isCheckboxColumn ? attributes : {})}
        {...(!isCheckboxColumn ? listeners : {})}
        aria-describedby="header-tooltip">
        <div
          className={cn(
            header.index === 0 ? '' : 'border-l border-foreground-200/80 dark:border-foreground/10',
            'pr-3 h-full relative py-1 w-full'
          )}>
          {header.isPlaceholder ? null : <HeaderCell header={header} isDragging={isDragging} />}
        </div>
      </div>

      {/* Resize handle */}
      {columnDef.enableResize !== false && header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={cn(
            'absolute top-2 bottom-2 right-0 translate-x-[2.5px] w-1 rounded-full hover:bg-blue-500 cursor-col-resize pointer-events-auto z-20',
            header.column.getIsResizing() && 'bg-accent-500'
          )}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
}
