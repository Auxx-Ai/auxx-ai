// apps/web/src/components/dynamic-table/components/table-scroll-area.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area'
import type * as React from 'react'

interface TableScrollAreaProps {
  children: React.ReactNode
  /** Ref to the internal scroll viewport element */
  viewportRef?: React.Ref<HTMLDivElement>
  /** Additional classes for the root container */
  className?: string
}

/**
 * ScrollArea tailored for the dynamic table.
 *
 * Uses base-ui primitives directly so scrollbar z-index can sit above
 * sticky headers (z-21) and pinned columns (z-30).
 */
function TableScrollArea({ children, viewportRef, className }: TableScrollAreaProps) {
  return (
    <BaseScrollArea.Root
      className={cn('relative box-border overflow-hidden flex flex-col flex-1 h-full', className)}>
      <BaseScrollArea.Viewport ref={viewportRef} className='h-full w-full flex flex-col'>
        {children}
      </BaseScrollArea.Viewport>

      {/* Vertical scrollbar — z-40 to sit above sticky headers (z-21) and pinned cols (z-30) */}
      <BaseScrollArea.Scrollbar
        orientation='vertical'
        className={cn(
          'z-40 flex justify-center w-2 rounded-md my-2 mr-1.5 bg-foreground/10 dark:bg-primary-100',
          'opacity-0 transition-opacity duration-150',
          'data-[scrolling]:opacity-100 data-[scrolling]:transition-none',
          'data-[hovering]:opacity-100',
          'before:content-[""] before:absolute before:w-5 before:h-full'
        )}>
        <BaseScrollArea.Thumb className='w-full rounded-[inherit] bg-foreground/20 dark:bg-white/10' />
      </BaseScrollArea.Scrollbar>

      {/* Horizontal scrollbar */}
      <BaseScrollArea.Scrollbar
        orientation='horizontal'
        className={cn(
          'z-40 flex items-center h-2 rounded-md mx-2 mb-1.5 bg-foreground/10 dark:bg-primary-100',
          'opacity-0 transition-opacity duration-150',
          'data-[scrolling]:opacity-100 data-[scrolling]:transition-none',
          'data-[hovering]:opacity-100',
          'before:content-[""] before:absolute before:h-5 before:w-full'
        )}>
        <BaseScrollArea.Thumb className='h-full rounded-[inherit] bg-foreground/20 dark:bg-white/10' />
      </BaseScrollArea.Scrollbar>

      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  )
}

export { TableScrollArea }
