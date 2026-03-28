// apps/web/src/components/resources/ui/record-badge.tsx
'use client'

// Type imports
import type { RecordId } from '@auxx/lib/resources/client'
// Utility imports
import { getDefinitionId } from '@auxx/lib/resources/client'
// UI component imports
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
// External libraries
import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'

// Hook imports
import { useRecord, useResource } from '~/components/resources'
import { type GetRecordLinkOptions, useRecordLink } from '../utils/get-record-link'

/**
 * Variants for the RecordBadge component
 */
export const recordBadgeVariants = cva(
  'flex items-center rounded-[5px] ring-1 py-0 focus-visible:outline-none',
  {
    variants: {
      variant: {
        default:
          'cursor-default ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-muted dark:ring-neutral-800',
        link: 'cursor-pointer ring-transparent hover:ring-neutral-300 bg-neutral-100 text-neutral-600 dark:text-neutral-100 dark:bg-muted dark:ring-muted hover:bg-neutral-200 dark:hover:bg-muted/60 [&_[data-slot=record-display]]:underline hover:[&_[data-slot=record-display]]:no-underline',
      },
      size: {
        default: [
          'h-5 gap-1.5 ps-0.5 pe-1.5 text-sm',
          '[&_[data-slot=avatar-fallback]]:text-[10px]',
          '[&_[data-slot=skeleton]:first-child]:size-4 [&_[data-slot=skeleton]:first-child]:rounded-full',
          '[&_[data-slot=skeleton]:last-child]:h-4 [&_[data-slot=skeleton]:last-child]:w-20 [&_[data-slot=skeleton]:last-child]:rounded-full',
        ].join(' '),
        sm: [
          'h-4 gap-1 ps-0.5 pe-1 text-xs',
          '[&_[data-slot=avatar-fallback]]:text-[8px]',
          '[&_[data-slot=skeleton]:first-child]:size-3 [&_[data-slot=skeleton]:first-child]:rounded-full',
          '[&_[data-slot=skeleton]:last-child]:h-3 [&_[data-slot=skeleton]:last-child]:w-14 [&_[data-slot=skeleton]:last-child]:rounded-full',
        ].join(' '),
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

/**
 * Props for the RecordBadge component.
 */
interface RecordBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** RecordId in format "entityDefinitionId:entityInstanceId" - optional, shows loading when undefined */
  recordId?: RecordId | null
  /** Whether to show icon/avatar (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
  /** Link configuration - if true uses default link, if object uses those options */
  link?: boolean | GetRecordLinkOptions
}

/**
 * A reusable badge component that displays a resource with an optional icon/avatar and its display name.
 * Fetches data using the existing resource hooks and shows appropriate loading states.
 *
 * @param recordId - RecordId in format "entityDefinitionId:entityInstanceId"
 * @param showIcon - Whether to show icon/avatar (default: true)
 * @param className - Additional CSS classes
 * @param variant - Visual variant (default | link)
 * @param link - If true, wraps badge in Link; if object, uses those GetRecordLinkOptions
 *
 * @example
 * // Basic usage with icon
 * <RecordBadge recordId={toRecordId('contact', contactId)} />
 *
 * @example
 * // Without icon
 * <RecordBadge recordId={recordId} showIcon={false} />
 *
 * @example
 * // With custom styling
 * <RecordBadge recordId={recordId} className="ring-blue-500" />
 *
 * @example
 * // As a link with default options
 * <RecordBadge recordId={recordId} variant="link" link={true} />
 *
 * @example
 * // As a link with custom options
 * <RecordBadge recordId={recordId} variant="link" link={{ tab: 'activity', action: 'edit' }} />
 */
export function RecordBadge({
  recordId,
  showIcon = true,
  className,
  variant,
  size,
  link,
  ...props
}: RecordBadgeProps) {
  // Fetch record data (displayName, avatarUrl)
  const {
    record,
    isLoading: isLoadingRecord,
    isNotFound,
  } = useRecord({ recordId, enabled: !!recordId })

  // Extract entityDefinitionId from recordId
  const entityDefinitionId = recordId ? getDefinitionId(recordId) : undefined

  // Fetch resource metadata (icon, color) - only used when no avatar exists
  const { resource, isLoading: isLoadingResource } = useResource(entityDefinitionId)

  // Generate link if link prop is provided
  const linkOptions = typeof link === 'object' ? link : undefined
  const href = useRecordLink(link ? recordId : null, linkOptions)

  // Determine display name
  const displayName = isNotFound ? 'Unknown' : (record?.displayName ?? 'Unknown')

  // Show loading state when recordId is undefined or when loading AND no cached data exists
  const isLoading = !recordId || ((isLoadingRecord || isLoadingResource) && !record)

  // Determine variant: if link is provided, default to 'link' variant unless explicitly set
  const effectiveVariant = variant ?? (link ? 'link' : 'default')

  // Choose the component type based on link prop
  const Comp = link && href ? Link : 'div'

  const avatarSize = size === 'sm' ? 'size-3' : 'size-4'

  return (
    <Comp
      data-slot='record-badge'
      aria-busy={isLoading}
      {...(link && href ? { href } : {})}
      className={cn(recordBadgeVariants({ variant: effectiveVariant, size }), className)}
      {...props}>
      {isLoading ? (
        <>
          {showIcon && <Skeleton />}
          <Skeleton />
        </>
      ) : (
        <>
          {/* Show Avatar if avatarUrl exists, else show EntityIcon if showIcon=true */}
          {record?.avatarUrl ? (
            <Avatar className={avatarSize} data-slot='record-icon'>
              <AvatarImage src={record.avatarUrl} />
              <AvatarFallback>{displayName?.[0]}</AvatarFallback>
            </Avatar>
          ) : showIcon ? (
            <EntityIcon
              data-slot='record-icon'
              iconId={resource?.icon || 'circle'}
              color={resource?.color || 'gray'}
              size='xs'
            />
          ) : null}
          <span data-slot='record-display' className='truncate'>
            {displayName}
          </span>
        </>
      )}
    </Comp>
  )
}
