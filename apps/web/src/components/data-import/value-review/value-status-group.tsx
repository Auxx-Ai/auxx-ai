// apps/web/src/components/data-import/value-review/value-status-group.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface ValueStatusGroupProps {
  status: string
  label: string
  icon: LucideIcon
  color: string
  count: number
  isExpanded: boolean
  onToggle: () => void
  /**
   * A remedy for the whole group, rendered on the right of the header.
   *
   * The header is the only place a WHOLE-group fix belongs: a per-row editor
   * invites retyping fourteen values one at a time, which is exactly what the
   * unmatched-options case must not read as the intended cure.
   */
  action?: ReactNode
}

/**
 * Expandable status group header.
 * Click to expand/collapse the values within this status.
 */
export function ValueStatusGroup({
  label,
  icon: Icon,
  color,
  count,
  isExpanded,
  onToggle,
  action,
}: ValueStatusGroupProps) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        'flex items-center justify-between px-4 h-9 cursor-pointer transition-colors border-b border-border/50 sticky top-0 z-10',
        isExpanded && 'border-primary-300 bg-primary-100/80 backdrop-blur-sm'
      )}>
      <div className='flex items-center gap-3'>
        <ChevronRight
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-90'
          )}
        />
        <Icon className={cn('size-4', color)} />
        <span className='text-sm text-muted-foreground'>{label}</span>
        <Badge variant='pill' size='sm'>
          {count} value{count !== 1 ? 's' : ''}
        </Badge>
      </div>
      {/* The action must not toggle the group it sits on. */}
      {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
    </div>
  )
}
