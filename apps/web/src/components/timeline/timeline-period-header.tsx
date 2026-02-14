// apps/web/src/components/timeline/timeline-period-header.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ChevronDown, ChevronLeft } from 'lucide-react'

/**
 * Props for the TimelinePeriodHeader component
 */
interface TimelinePeriodHeaderProps {
  year: string
  period: string
  isCollapsed?: boolean
  onToggle?: () => void
}

/**
 * Renders a collapsible header for a timeline period (month/year)
 */
export function TimelinePeriodHeader({
  year,
  period,
  isCollapsed = false,
  onToggle,
}: TimelinePeriodHeaderProps) {
  return (
    <div className='flex flex-col pb-2'>
      {/* Year Label */}
      {year && <div className='text-sm font-medium text-primary-400 mb-1'>{year}</div>}

      {/* Period Label with Toggle */}
      <div className='flex items-center gap-1'>
        <Badge variant='pill' size='sm'>
          {period}
        </Badge>
        <span className='h-px flex-1 bg-primary-100' role='none' />

        <Button
          type='button'
          size='icon-xs'
          variant='ghost'
          onClick={onToggle}
          aria-label={isCollapsed ? 'Expand period' : 'Collapse period'}>
          {isCollapsed ? <ChevronLeft /> : <ChevronDown />}
        </Button>
      </div>
    </div>
  )
}
