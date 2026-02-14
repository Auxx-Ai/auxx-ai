// apps/web/src/components/detail-view/components/detail-view-card-header.tsx
'use client'

import { formatDistanceToNow } from 'date-fns'
import { Box } from 'lucide-react'
import React from 'react'
import type { DetailViewCardHeaderProps } from '../types'
import { getIconComponent } from '../utils'

/**
 * DetailViewCardHeader - card header for the sidebar showing entity info
 */
export function DetailViewCardHeader({
  icon,
  color,
  displayName,
  record,
}: DetailViewCardHeaderProps) {
  // Get icon component
  const IconComponent = icon ? getIconComponent(icon) : Box

  // Format created at text
  const createdAtText = React.useMemo(() => {
    const createdAt = record.createdAt as string | Date | undefined
    if (!createdAt) return null
    return `Created ${formatDistanceToNow(new Date(createdAt), { addSuffix: true })}`
  }, [record.createdAt])

  return (
    <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
      <div
        className='size-10 border bg-muted rounded-lg flex items-center justify-center shrink-0'
        style={color ? { backgroundColor: `${color}20` } : undefined}>
        <IconComponent
          className='size-6 text-neutral-500 dark:text-foreground'
          style={color ? { color } : undefined}
        />
      </div>
      <div className='flex flex-col align-start w-full min-w-0'>
        <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate'>
          {displayName}
        </div>
        {createdAtText && <div className='text-xs text-neutral-500 truncate'>{createdAtText}</div>}
      </div>
    </div>
  )
}
