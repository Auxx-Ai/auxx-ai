// packages/ui/src/components/column-resize-handle.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'

export interface ColumnResizeHandleProps {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  /** True while this column is being dragged. */
  resizing?: boolean
  className?: string
}

/** The drag handle on a header cell's right edge. Same look as the dynamic table's. */
export function ColumnResizeHandle({
  onPointerDown,
  resizing,
  className,
}: ColumnResizeHandleProps) {
  return (
    <div
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize column'
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'pointer-events-auto absolute top-2 right-0 bottom-2 z-20 w-1 translate-x-[2.5px] cursor-col-resize touch-none rounded-full hover:bg-blue-500',
        resizing && 'bg-accent-500',
        className
      )}
    />
  )
}
