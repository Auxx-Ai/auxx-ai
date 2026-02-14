// apps/web/src/components/tags/ui/tag-badge.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import { useRecord, useSystemValues } from '~/components/resources/hooks'

interface TagBadgeProps {
  /** RecordId in format "entityDefinitionId:instanceId" - optional, shows loading when undefined */
  recordId?: RecordId
  size?: 'sm' | 'md'
  onRemove?: () => void
  className?: string
}

/**
 * Reusable tag badge component with emoji, color, and optional remove button.
 * Follows RecordBadge pattern - takes recordId and reads from stores.
 *
 * Requires useTagHierarchy() to be called somewhere to pre-populate stores.
 * If tag not in store, useRecord will queue a fetch automatically.
 */
export function TagBadge({ recordId, size = 'md', onRemove, className, ...props }: TagBadgeProps) {
  // Get base record data (displayName)
  const { record, isLoading: recordLoading } = useRecord({ recordId, enabled: !!recordId })
  // Get tag-specific field values using system attributes
  const { values, isLoading: valuesLoading } = useSystemValues(
    recordId,
    ['tag_color', 'tag_emoji'],
    { autoFetch: true, enabled: !!recordId }
  )

  const color = values.tag_color as string | undefined
  const emoji = values.tag_emoji as string | undefined

  // Show loading when recordId is undefined or when fetching data
  const isLoading = !recordId || recordLoading || valuesLoading

  const displayName = record?.displayName ?? 'Unknown'
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5 h-5' : 'text-sm px-2 py-1 h-6'

  if (isLoading) {
    return <Skeleton className={cn('h-5 w-16 rounded-[5px]', className)} />
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] border shrink-0',
        sizeClasses,
        className
      )}
      style={{
        backgroundColor: color ? `${color}20` : undefined,
        borderColor: color ? `${color}40` : undefined,
      }}
      {...props}>
      {emoji && <span>{emoji}</span>}
      {color && !emoji && (
        <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: color }} />
      )}
      <span data-slot='text' className='font-medium shrink-0'>
        {displayName}
      </span>
      {onRemove && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className='ml-0.5 rounded hover:bg-muted shrink-0'>
          <X className='size-3 shrink-0' />
        </button>
      )}
    </span>
  )
}
