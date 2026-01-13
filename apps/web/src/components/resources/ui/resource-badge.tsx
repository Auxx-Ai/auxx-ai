// apps/web/src/components/resources/ui/resource-badge.tsx
'use client'

// External libraries
import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
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
import { useResourceLink, type GetResourceLinkOptions } from '../utils/get-resource-link'

/**
 * Variants for the ResourceBadge component
 */
export const resourceBadgeVariants = cva(
  'flex text-sm items-center h-4.5 gap-1.5 rounded-[5px] ring-1 ps-0.5 pe-1.5 py-0',
  {
    variants: {
      variant: {
        default:
          'cursor-default ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800',
        link: 'cursor-pointer ring-transparent hover:ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-neutral-800 dark:ring-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 [&_[data-slot=resource-display]]:underline hover:[&_[data-slot=resource-display]]:no-underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Props for the ResourceBadge component.
 */
interface ResourceBadgeProps extends VariantProps<typeof resourceBadgeVariants> {
  /** ResourceId in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
  /** Whether to show icon/avatar (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
  /** Link configuration - if true uses default link, if object uses those options */
  link?: boolean | GetResourceLinkOptions
}

/**
 * A reusable badge component that displays a resource with an optional icon/avatar and its display name.
 * Fetches data using the existing resource hooks and shows appropriate loading states.
 *
 * @param resourceId - ResourceId in format "entityDefinitionId:entityInstanceId"
 * @param showIcon - Whether to show icon/avatar (default: true)
 * @param className - Additional CSS classes
 * @param variant - Visual variant (default | link)
 * @param link - If true, wraps badge in Link; if object, uses those GetResourceLinkOptions
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
 *
 * @example
 * // As a link with default options
 * <ResourceBadge resourceId={resourceId} variant="link" link={true} />
 *
 * @example
 * // As a link with custom options
 * <ResourceBadge resourceId={resourceId} variant="link" link={{ tab: 'activity', action: 'edit' }} />
 */
export function ResourceBadge({
  resourceId,
  showIcon = true,
  className,
  variant,
  link,
}: ResourceBadgeProps) {
  // Fetch record data (displayName, avatarUrl)
  const { record, isLoading: isLoadingRecord, isNotFound } = useRecord({ resourceId })

  // Extract entityDefinitionId from resourceId
  const entityDefinitionId = getDefinitionId(resourceId)

  // Fetch resource metadata (icon, color) - only used when no avatar exists
  const { resource, isLoading: isLoadingResource } = useResource(entityDefinitionId)

  // Generate link if link prop is provided
  const linkOptions = typeof link === 'object' ? link : undefined
  const href = useResourceLink(link ? resourceId : null, linkOptions)

  // Determine display name
  const displayName = isNotFound ? 'Unknown' : (record?.displayName ?? 'Unknown')

  // Show loading state when loading AND no cached data exists
  const isLoading = (isLoadingRecord || isLoadingResource) && !record

  // Determine variant: if link is provided, default to 'link' variant unless explicitly set
  const effectiveVariant = variant ?? (link ? 'link' : 'default')

  // Choose the component type based on link prop
  const Comp = link && href ? Link : 'div'

  return (
    <Comp
      data-slot="resource-badge"
      aria-busy={isLoading}
      {...(link && href ? { href } : {})}
      className={cn(resourceBadgeVariants({ variant: effectiveVariant }), className)}>
      {isLoading ? (
        <>
          {showIcon && <Skeleton className="size-4 rounded-full" />}
          <Skeleton className="h-4 w-20 rounded-full" />
        </>
      ) : (
        <>
          {/* Show Avatar if avatarUrl exists, else show EntityIcon if showIcon=true */}
          {record?.avatarUrl ? (
            <Avatar className="size-4" data-slot="resource-icon">
              <AvatarImage src={record.avatarUrl} />
              <AvatarFallback className="text-[10px]">{displayName?.[0]}</AvatarFallback>
            </Avatar>
          ) : showIcon ? (
            <EntityIcon
              data-slot="resource-icon"
              iconId={resource?.icon || 'circle'}
              color={resource?.color || 'gray'}
              size="xs"
            />
          ) : null}
          <span data-slot="resource-display">{displayName}</span>
        </>
      )}
    </Comp>
  )
}
