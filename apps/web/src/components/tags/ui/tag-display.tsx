// apps/web/src/components/tags/ui/tag-display.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { X } from 'lucide-react'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'

interface TagDisplayProps {
  title: string
  emoji?: string | null
  color?: string | null
  onRemove?: () => void
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Single tag display with color background
 */
export function TagDisplay({
  title,
  emoji,
  color = 'gray',
  onRemove,
  size = 'md',
}: TagDisplayProps) {
  const sizeClasses = {
    sm: 'text-xs py-0.5 px-2',
    md: 'text-sm py-1 px-2',
    lg: 'text-base py-1.5 px-3',
  }

  const colorData = getOptionColor((color || 'gray') as SelectOptionColor)

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full',
        sizeClasses[size],
        colorData.badgeClasses
      )}>
      {emoji && <span className='mr-1'>{emoji}</span>}
      <span>{title}</span>
      {onRemove && (
        <button onClick={onRemove} className='ml-1 rounded-full hover:bg-black/10'>
          <X className='h-4 w-4 opacity-60 hover:opacity-100' />
        </button>
      )}
    </div>
  )
}

interface SelectedTagsDisplayProps {
  tagIds: string[]
  onRemove?: (tagId: string) => void
  maxDisplay?: number
  showRemove?: boolean
  className?: string
}

/**
 * Component to display selected tags with their names and optional remove functionality
 */
export function SelectedTagsDisplay({
  tagIds,
  onRemove,
  maxDisplay = 3,
  showRemove = false,
  className,
}: SelectedTagsDisplayProps) {
  const { tagMap } = useTagHierarchy()

  /** Get tag by ID from the tagMap */
  const getTagById = (id: string): TagNode | undefined => {
    return tagMap.get(id)
  }

  /** Get display name for a tag (with emoji if present) */
  const getTagDisplayName = (id: string): string => {
    const tag = getTagById(id)
    if (!tag) return id
    return tag.tag_emoji ? `${tag.tag_emoji} ${tag.title}` : tag.title
  }

  if (!tagIds || tagIds.length === 0) {
    return <span className='text-sm text-muted-foreground'>No tags selected</span>
  }

  const displayTags = tagIds.slice(0, maxDisplay)
  const remainingCount = tagIds.length - maxDisplay

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {displayTags.map((tagId) => {
        const tag = getTagById(tagId)
        const displayName = getTagDisplayName(tagId)
        const colorData = getOptionColor((tag?.tag_color || 'gray') as SelectOptionColor)

        return (
          <Badge
            key={tagId}
            variant='secondary'
            className={cn('inline-flex items-center gap-1 text-xs', colorData.badgeClasses)}>
            <span>{displayName}</span>
            {showRemove && onRemove && (
              <Button
                variant='ghost'
                size='icon'
                className='h-3 w-3 hover:bg-destructive hover:text-destructive-foreground'
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(tagId)
                }}>
                <X className='h-2 w-2' />
              </Button>
            )}
          </Badge>
        )
      })}

      {remainingCount > 0 && (
        <Badge variant='outline' className='text-xs'>
          +{remainingCount} more
        </Badge>
      )}
    </div>
  )
}

/**
 * Simple tag display for search query (no interaction)
 */
export function SearchTagDisplay({ tagIds }: { tagIds: string[] }) {
  const { tagMap } = useTagHierarchy()

  /** Get display name for a tag (with emoji if present) */
  const getTagDisplayName = (id: string): string => {
    const tag = tagMap.get(id)
    if (!tag) return id
    return tag.tag_emoji ? `${tag.tag_emoji} ${tag.title}` : tag.title
  }

  if (!tagIds || tagIds.length === 0) {
    return null
  }

  return (
    <>
      {tagIds.map((tagId) => {
        const displayName = getTagDisplayName(tagId)
        return (
          <span key={tagId} className='text-xs bg-green-100 text-green-800 px-1 rounded'>
            {displayName}
          </span>
        )
      })}
    </>
  )
}
