// apps/web/src/components/resources/ui/resource-badge.tsx
'use client'

// External libraries
import { cn } from '@auxx/ui/lib/utils'

// Type imports
import type { ResourceId } from '@auxx/lib/resources/client'

// Utility imports
import { getDefinitionId } from '@auxx/lib/resources/client'

// UI component imports
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'

// Hook imports
import { useRecord, useResource } from '~/components/resources'

/**
 * Props for the ResourceBadge component.
 */
interface ResourceBadgeProps {
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
  /** Whether to show icon/avatar (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * A reusable badge component that displays a resource with an optional icon/avatar and its display name.
 * Fetches data using the existing resource hooks and shows appropriate loading states.
 *
 * @param resourceId - ResourceId in format "entityDefinitionId:entityInstanceId"
 * @param showIcon - Whether to show icon/avatar (default: true)
 * @param className - Additional CSS classes
 *
 * @example
 * // Basic usage with icon
 * <ResourceBadge resourceId={toResourceId('contact', contactId)} />
 *
 * @example
 * // Without icon
 * <ResourceBadge resourceId={resourceId} showIcon={false} />
 *
 * @example
 * // With custom styling
 * <ResourceBadge resourceId={resourceId} className="ring-blue-500" />
 */
export function ResourceBadge({ resourceId, showIcon = true, className }: ResourceBadgeProps) {
  // Fetch record data (displayName, avatarUrl)
  const { record, isLoading: isLoadingRecord, isNotFound } = useRecord({ resourceId })

  // Extract entityDefinitionId from resourceId
  const entityDefinitionId = getDefinitionId(resourceId)

  // Fetch resource metadata (icon, color) - only used when no avatar exists
  const { resource, isLoading: isLoadingResource } = useResource(entityDefinitionId)

  // Determine display name
  const displayName = isNotFound ? 'Unknown' : record?.displayName ?? 'Unknown'

  // Show loading state when loading AND no cached data exists
  const isLoading = (isLoadingRecord || isLoadingResource) && !record

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-[5px] ring-1',
        'ring-neutral-300 bg-neutral-100 text-neutral-600',
        'dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800',
        'px-2 py-0',
        className
      )}
    >
      {isLoading ? (
        <>
          {showIcon && <Skeleton className="size-4 rounded-full" />}
          <Skeleton className="h-4 w-20 rounded-full" />
        </>
      ) : (
        <>
          {/* Show Avatar if avatarUrl exists, else show EntityIcon if showIcon=true */}
          {record?.avatarUrl ? (
            <Avatar className="size-4">
              <AvatarImage src={record.avatarUrl} />
              <AvatarFallback className="text-[10px]">{displayName?.[0]}</AvatarFallback>
            </Avatar>
          ) : showIcon ? (
            <EntityIcon
              iconId={resource?.icon || 'circle'}
              color={resource?.color || 'gray'}
              size="xs"
            />
          ) : null}
          <span>{displayName}</span>
        </>
      )}
    </div>
  )
}
