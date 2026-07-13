// apps/web/src/components/dispatch/ui/sidebar/sidebar-group-header.tsx

'use client'

import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import type { ReactNode } from 'react'

interface SidebarGroupHeaderProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  count?: number
  actions?: ReactNode
  className?: string
}

/**
 * Shared Notion-style collapsible group header (chevron + title + optional count/actions) for
 * the dispatch module sidebar's Workers/Tags/Backlog/Routes groups (v3 sidebar plan §1.2) —
 * `SidebarGroupLabel` rendered `asChild` as a full-width button, mirroring
 * `collapsible-sidebar-section.tsx`'s chevron-toggle pattern but against the dispatch sidebar
 * store instead of `auxx:sidebar-state`.
 */
export function SidebarGroupHeader({
  title,
  open,
  onOpenChange,
  count,
  actions,
  className,
}: SidebarGroupHeaderProps) {
  return (
    <SidebarGroupLabel asChild className={className}>
      <button
        type='button'
        className='flex w-full items-center justify-between gap-1'
        onClick={() => onOpenChange(!open)}>
        <span className='flex min-w-0 items-center gap-1'>
          <CollapsibleChevron open={open} />
          <span className='truncate'>{title}</span>
        </span>
        <span className='flex shrink-0 items-center gap-1'>
          {typeof count === 'number' && count > 0 && (
            <span className='text-muted-foreground/70 text-xs tabular-nums'>{count}</span>
          )}
          {actions}
        </span>
      </button>
    </SidebarGroupLabel>
  )
}
