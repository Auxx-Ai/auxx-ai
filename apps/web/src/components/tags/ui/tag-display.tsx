// apps/web/src/components/tags/ui/tag-display.tsx
'use client'

import { X } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
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
 * Calculate contrast color for text based on background brightness
 */
function getContrastColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}

/**
 * Single tag display with color background
 */
export function TagDisplay({
  title,
  emoji,
  color = '#e2e8f0',
  onRemove,
  size = 'md',
}: TagDisplayProps) {
  const sizeClasses = {
    sm: 'text-xs py-0.5 px-2',
    md: 'text-sm py-1 px-2',
    lg: 'text-base py-1.5 px-3',
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full ${sizeClasses[size]}`}
      style={{
        backgroundColor: color || '#e2e8f0',
        color: getContrastColor(color || '#e2e8f0'),
      }}>
      {emoji && <span className="mr-1">{emoji}</span>}
      <span>{title}</span>
      {onRemove && (
        <button onClick={onRemove} className="ml-1 rounded-full hover:bg-black/10">
          <X className="h-4 w-4 opacity-60 hover:opacity-100" />
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
    return <span className="text-sm text-muted-foreground">No tags selected</span>
  }

  const displayTags = tagIds.slice(0, maxDisplay)
  const remainingCount = tagIds.length - maxDisplay

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {displayTags.map((tagId) => {
        const tag = getTagById(tagId)
        const displayName = getTagDisplayName(tagId)

        return (
          <Badge
            key={tagId}
            variant="secondary"
            className="inline-flex items-center gap-1 text-xs"
            style={{
              backgroundColor: tag?.tag_color ? `${tag.tag_color}20` : undefined,
              borderColor: tag?.tag_color || undefined,
            }}>
            <span>{displayName}</span>
            {showRemove && onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-3 w-3 hover:bg-destructive hover:text-destructive-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(tagId)
                }}>
                <X className="h-2 w-2" />
              </Button>
            )}
          </Badge>
        )
      })}

      {remainingCount > 0 && (
        <Badge variant="outline" className="text-xs">
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
          <span key={tagId} className="text-xs bg-green-100 text-green-800 px-1 rounded">
            {displayName}
          </span>
        )
      })}
    </>
  )
}
