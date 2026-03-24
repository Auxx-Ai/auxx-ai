// apps/web/src/components/ui/tags-view.tsx
'use client'

import type { SelectOption, SelectOptionColor } from '@auxx/types/custom-field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { useMemo } from 'react'
import { ItemsCellView, type ItemsListItem, ItemsListView } from './items-list-view'

/**
 * Props for TagsView components
 */
export interface TagsViewProps {
  /** Raw value - can be string[], comma-separated string, or single value */
  value: string | string[] | null | undefined
  /** Available options with value/label pairs */
  options: SelectOption[]
  /** Badge variant - defaults to 'pill' */
  variant?: Variant
  /** Additional className for container */
  className?: string
}

/**
 * Internal tag item type for use with ItemsCellView
 */
interface TagItem extends ItemsListItem {
  id: string
  label: string
  color?: SelectOptionColor
}

/**
 * Resolves tag IDs/values to TagItem array
 */
export function resolveTagItems(
  value: string | string[] | null | undefined,
  options: SelectOption[]
): TagItem[] {
  let selectedIds: string[] = []
  if (Array.isArray(value)) {
    selectedIds = value
  } else if (typeof value === 'string' && value) {
    selectedIds = value.split(',').filter(Boolean)
  }

  return selectedIds
    .map((id, index) => {
      const option = options.find((opt) => opt.value === id)
      if (option) return { id: `${id}-${index}`, label: option.label, color: option.color }
      // If not a UUID, show as-is (legacy data)
      if (!id.includes('-') || id.length < 36) return { id: `${id}-${index}`, label: id }
      return null
    })
    .filter((item): item is TagItem => item !== null)
}

/**
 * Resolves tag IDs/values to their display labels (for backward compatibility)
 */
export function resolveTagLabels(
  value: string | string[] | null | undefined,
  options: SelectOption[]
): string[] {
  return resolveTagItems(value, options).map((item) => item.label)
}

/**
 * TagsView component - Simple view for non-table contexts
 */
export function TagsView({ value, options, variant = 'pill', className }: TagsViewProps) {
  const tags = useMemo(() => resolveTagItems(value, options), [value, options])

  return (
    <ItemsListView
      items={tags}
      renderItem={(tag) => (
        <Badge variant={tag.color ?? variant} shape='tag'>
          {tag.label}
        </Badge>
      )}
      className={className}
    />
  )
}

/**
 * TagsCellView component - Table cell variant with expandable hover
 */
export function TagsCellView({ value, options, variant = 'pill', className }: TagsViewProps) {
  const tags = useMemo(() => resolveTagItems(value, options), [value, options])

  return (
    <ItemsCellView
      items={tags}
      renderItem={(tag) => (
        <Badge variant={tag.color ?? variant} shape='tag'>
          {tag.label}
        </Badge>
      )}
      className={className}
    />
  )
}
