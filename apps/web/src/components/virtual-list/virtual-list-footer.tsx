// apps/web/src/components/virtual-list/virtual-list-footer.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'
import { useVirtualListContext } from './virtual-list'

/**
 * Props for the VirtualListFooter component
 */
interface VirtualListFooterProps {
  className?: string
  children?: ReactNode
  showItemCount?: boolean
}

/**
 * Footer component for VirtualList with item count display
 */
export function VirtualListFooter({
  className,
  children,
  showItemCount = true,
}: VirtualListFooterProps) {
  const { items } = useVirtualListContext()

  if (!showItemCount && !children) return null

  return (
    <div
      className={cn(
        'border-t py-2 px-4 text-sm text-muted-foreground bg-background/50 backdrop-blur-sm sticky bottom-0',
        className
      )}>
      {showItemCount && <span>{items.length} items</span>}
      {children}
    </div>
  )
}
