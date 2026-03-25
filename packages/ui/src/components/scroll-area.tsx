// packages/ui/src/components/scroll-area.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area'
import type * as React from 'react'

interface ScrollAreaProps {
  children: React.ReactNode
  /** Scroll orientation: vertical (default), horizontal, or both */
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Ref to the internal scroll viewport element (useful for IntersectionObserver root) */
  viewportRef?: React.Ref<HTMLDivElement>
  /** Additional classes for the root container */
  className?: string
  /** Additional classes for the scrollbar */
  scrollbarClassName?: string
  /** Custom fade classes applied to viewport pseudo-elements. When set, uses sticky gradient overlays instead of the default mask-image fade. */
  fadeClassName?: string
}

function ScrollArea({
  children,
  orientation = 'vertical',
  viewportRef,
  className,
  scrollbarClassName,
  fadeClassName,
}: ScrollAreaProps) {
  const showVertical = orientation === 'vertical' || orientation === 'both'
  const showHorizontal = orientation === 'horizontal' || orientation === 'both'

  return (
    <BaseScrollArea.Root className={cn('relative box-border overflow-hidden', className)}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        className={cn(
          'h-full w-full overscroll-contain outline-none',
          fadeClassName ? 'scroll-area-fade-custom' : 'scroll-area-fade',
          fadeClassName
        )}
        style={
          orientation !== 'both'
            ? {
                overflowX: showHorizontal ? undefined : 'hidden',
                overflowY: showVertical ? undefined : 'hidden',
              }
            : undefined
        }>
        <BaseScrollArea.Content
          className={showVertical ? 'min-h-full flex flex-col' : undefined}
          style={!showHorizontal ? { minWidth: undefined } : undefined}>
          {children}
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>

      {showVertical && (
        <BaseScrollArea.Scrollbar
          orientation='vertical'
          className={cn(
            'flex justify-center w-2 rounded-md my-2 mr-1.5 bg-foreground/10 dark:bg-primary-100',
            'opacity-0 transition-opacity duration-150',
            'data-[scrolling]:opacity-100 data-[scrolling]:transition-none',
            'data-[hovering]:opacity-100',
            'before:content-[""] before:absolute before:w-5 before:h-full',
            scrollbarClassName
          )}>
          <BaseScrollArea.Thumb className='w-full rounded-[inherit] bg-foreground/20 dark:bg-primary-50' />
        </BaseScrollArea.Scrollbar>
      )}

      {showHorizontal && (
        <BaseScrollArea.Scrollbar
          orientation='horizontal'
          className={cn(
            'flex justify-center h-2 rounded-md mx-2 mb-1.5 bg-foreground/10 dark:bg-primary-100',
            'opacity-0 transition-opacity duration-150',
            'data-[scrolling]:opacity-100 data-[scrolling]:transition-none',
            'data-[hovering]:opacity-100',
            'before:content-[""] before:absolute before:h-5 before:w-full',
            scrollbarClassName
          )}>
          <BaseScrollArea.Thumb className='h-full rounded-[inherit] bg-foreground/20 dark:bg-primary-50' />
        </BaseScrollArea.Scrollbar>
      )}

      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  )
}

export { ScrollArea }
