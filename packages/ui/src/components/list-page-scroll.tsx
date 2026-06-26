// packages/ui/src/components/list-page-scroll.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'

interface ListPageScrollProps {
  /** A `<ListToolbar/>` (already sticky); rendered as the first scroll child. */
  toolbar?: React.ReactNode
  children: React.ReactNode
  /** Extra ScrollArea root classes. */
  className?: string
  /** Body wrapper classes around `children`. Default `p-3 sm:p-6`. */
  bodyClassName?: string
}

/**
 * Scrollable body for list pages: a `ScrollArea` with the canonical `bg-muted`
 * backdrop, a sticky toolbar slot, and a padded body wrapper. Lists that branch
 * on loading/empty/grid render those branches as `children` and should not
 * self-pad — the body wrapper owns padding.
 */
export function ListPageScroll({
  toolbar,
  children,
  className,
  bodyClassName,
}: ListPageScrollProps) {
  return (
    <ScrollArea className={cn('flex-1 min-h-0 bg-muted @container', className)}>
      {toolbar}
      <div className={cn('p-3 sm:p-6', bodyClassName)}>{children}</div>
    </ScrollArea>
  )
}
