// apps/web/src/components/groups/ui/group-badge.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import { Badge } from '@auxx/ui/components/badge'
import { getGroupMetadata } from '../utils'

/** Props for GroupBadge component */
interface GroupBadgeProps {
  /** The group to display */
  group: EntityInstanceEntity
  /** Additional class names */
  className?: string
}

/**
 * Small inline badge display for a group
 */
export function GroupBadge({ group, className }: GroupBadgeProps) {
  const metadata = getGroupMetadata(group)
  const emoji = metadata.icon || '👥'
  const color = metadata.color

  return (
    <Badge style={color ? { backgroundColor: color } : undefined} className={className}>
      <span className='mr-1'>{emoji}</span>
      {group.displayName}
    </Badge>
  )
}
