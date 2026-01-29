// apps/web/src/components/tags/ui/tag-badge.tsx
'use client'

import { X } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { getDefinitionId, type RecordId } from '@auxx/lib/resources/client'
import { toResourceFieldIds } from '@auxx/types/field'
import { useRecord, useResourceFieldValues } from '~/components/resources/hooks'

interface TagBadgeProps {
  /** RecordId in format "entityDefinitionId:instanceId" */
  recordId: RecordId
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
export function TagBadge({ recordId, size = 'md', onRemove, className }: TagBadgeProps) {
  // Get base record data (displayName)
  const { record, isLoading } = useRecord({ recordId })

  // Extract entityDefinitionId from recordId to build field references
  const entityDefId = getDefinitionId(recordId)

  // Build field references for tag-specific fields using toResourceFieldIds
  const [colorFieldRef, emojiFieldRef] = toResourceFieldIds(entityDefId, ['color', 'emoji'])

  // Get multiple field values at once (more efficient than multiple useFieldValue calls)
  const fieldValues = useResourceFieldValues(recordId, [colorFieldRef, emojiFieldRef])

  // Extract values (keyed by ResourceFieldId format)
  const color = fieldValues[colorFieldRef] as string | undefined
  const emoji = fieldValues[emojiFieldRef] as string | undefined

  const displayName = record?.displayName ?? 'Unknown'
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'

  if (isLoading) {
    return <Skeleton className={cn('h-5 w-16 rounded-md', className)} />
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border',
        sizeClasses,
        className
      )}
      style={{
        backgroundColor: color ? `${color}20` : undefined,
        borderColor: color ? `${color}40` : undefined,
      }}
    >
      {emoji && <span>{emoji}</span>}
      {color && !emoji && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="font-medium">{displayName}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 rounded hover:bg-muted"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
