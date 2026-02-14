'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import type * as React from 'react'

/**
 * Props for ScrollArea component.
 */
interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Scroll orientation: vertical (default), horizontal, or both */
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Additional classes for the scrollbar (use to override thickness, colors, etc.) */
  scrollbarClassName?: string
}

/**
 * ScrollArea component with configurable scroll orientation.
 * Use scrollbarClassName to customize scrollbar appearance (e.g., "w-1" for thinner vertical scrollbar).
 */
function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  scrollbarClassName,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        className={cn(
          'h-full w-full rounded-[inherit]',
          orientation !== 'horizontal' && '[&>div]:h-full [&>div]:!flex [&>div]:!flex-col'
        )}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      {(orientation === 'vertical' || orientation === 'both') && (
        <ScrollBar orientation='vertical' className={scrollbarClassName} />
      )}
      {(orientation === 'horizontal' || orientation === 'both') && (
        <ScrollBar orientation='horizontal' className={scrollbarClassName} />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-px',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-px',
        className
      )}
      {...props}>
      <ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-full bg-border' />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
