// apps/web/src/components/merge/merge-item-card.tsx
'use client'

import { type ReactNode } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EntityIcon } from '@auxx/ui/components/icons'
import { parseResourceId, isCustomResource, type ResourceId } from '@auxx/lib/resources/client'
import { useRecord, useResource } from '~/components/resources'

interface MergeItemCardProps {
  /** ResourceId of the item to display */
  resourceId: ResourceId
  /** Action buttons (remove, set as target, etc.) */
  actions?: ReactNode
  /** Additional CSS classes */
  className?: string
}

/**
 * Compact card for displaying a merge source item.
 * Shows avatar/icon, display name, and secondary info.
 */
export function MergeItemCard({ resourceId, actions, className }: MergeItemCardProps) {
  const { entityDefinitionId } = parseResourceId(resourceId)
  const { record, isLoading } = useRecord({ resourceId })
  const { resource } = useResource(entityDefinitionId)

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 ps-2 py-1 rounded-xl border', className)}>
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 ps-1.5 pe-1 py-1 rounded-xl border bg-card group hover:bg-muted/50 transition-colors',
        className
      )}>
      {/* Avatar or icon */}
      {record?.avatarUrl ? (
        <Avatar className="size-8">
          <AvatarImage src={record.avatarUrl} />
          <AvatarFallback>{record?.displayName?.[0] ?? '?'}</AvatarFallback>
        </Avatar>
      ) : (
        <EntityIcon
          iconId={resource?.icon ?? 'circle'}
          color={resource?.color ?? 'gray'}
          size="sm"
          inverse
        />
      )}

      {/* Name and secondary */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{record?.displayName ?? 'Untitled'}</span>
        {record && record.secondaryDisplayValue ? (
          <span className="text-xs text-muted-foreground truncate">
            {record.secondaryDisplayValue}
          </span>
        ) : null}
      </div>

      {/* Actions (remove, set as target) */}
      {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
    </div>
  )
}
