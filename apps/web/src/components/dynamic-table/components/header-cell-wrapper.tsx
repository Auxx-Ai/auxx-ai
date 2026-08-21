// apps/web/src/components/dynamic-table/components/header-cell-wrapper.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Header } from '@tanstack/react-table'
import { useTableConfig } from '../context/table-config-context'
import type { ExtendedColumnDef } from '../types'
import { sanitizeColumnId } from '../utils/sanitize-column-id'
import { HeaderCell } from './header-cell'

interface HeaderCellWrapperProps<TData> {
  header: Header<TData, unknown>
}

/**
 * Header cell wrapper with column resizing and drag logic
 */
export function HeaderCellWrapper<TData>({ header }: HeaderCellWrapperProps<TData>) {
  const columnDef = header.column.columnDef as ExtendedColumnDef
  const isCheckboxColumn = header.column.id === '_checkbox'
  const { disableColumnDnd } = useTableConfig()

  // Drag and drop functionality (disabled for checkbox column / widget tables)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: header.column.id,
    disabled: isCheckboxColumn || disableColumnDnd,
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
      className={cn('relative shrink-0', isDragging && 'opacity-30 z-50')}>
      <div
        // The activator node. dnd-kit's KeyboardSensor only starts a drag when
        // `event.target` IS this element (core.cjs `KeyboardSensor.activators`);
        // without the ref that guard short-circuits on a null activator and ANY
        // keydown reaching `listeners.onKeyDown` starts a column drag. Header
        // cells render dialogs (CustomFieldDialog) whose portal content is still
        // a REACT child of this div, so typing Space in a dialog field was being
        // preventDefault'd into a keyboard drag. Keyboard drag still works: the
        // `attributes` spread puts tabIndex=0 here, so focusing the header and
        // pressing Space targets this node directly.
        ref={setActivatorNodeRef}
        // `contain: inline-size` isolates this wrapper's inline-axis sizing
        // from descendant min-content. Without it, unbreakable content like a
        // SmartBreadcrumb path (whitespace-nowrap segments) would inflate the
        // column past its CSS-var width via `min-w-min`. `min-w-0` on flex
        // descendants only enables flex shrinking — it doesn't cap min-content
        // contribution to ancestors.
        className='group min-w-min py-2 h-full font-inter font-medium w-full [contain:inline-size]'
        {...(!isCheckboxColumn ? attributes : {})}
        {...(!isCheckboxColumn ? listeners : {})}
        aria-describedby='header-tooltip'>
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
