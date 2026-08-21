// apps/web/src/components/ui/tags-view.tsx
'use client'

import { resolveOptionIds } from '@auxx/lib/custom-fields/client'
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
  /**
   * The stored id matched no option in the field's current set. `label` then holds
   * the raw stored value, which is shown muted rather than as a normal tag (D2).
   */
  unknown?: boolean
}

/**
 * Resolves tag IDs/values to TagItem array.
 *
 * Matching is delegated to the shared resolver, so both option keyspaces (`id` and
 * `value`) resolve here exactly as they do on every other read path.
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

  return resolveOptionIds(selectedIds, options).map((resolved, index) =>
    resolved.status === 'known'
      ? { id: `${resolved.optionId}-${index}`, label: resolved.label, color: resolved.color }
      : { id: `${resolved.optionId}-${index}`, label: resolved.raw, unknown: true }
  )
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
 * Renders one resolved tag. Unknown ids get the muted `gray` badge plus a `title`,
 * so an orphaned value reads as "not in this field's option set" instead of as a
 * real tag that happens to be grey.
 */
function TagBadge({ tag, variant }: { tag: TagItem; variant: Variant }) {
  if (tag.unknown) {
    return (
      <Badge
        variant='gray'
        shape='tag'
        className='italic opacity-70'
        title={`${tag.label} — not in this field's option set`}>
        {tag.label}
      </Badge>
    )
  }

  return (
    <Badge variant={tag.color ?? variant} shape='tag'>
      {tag.label}
    </Badge>
  )
}

/**
 * TagsView component - Simple view for non-table contexts
 */
export function TagsView({ value, options, variant = 'pill', className }: TagsViewProps) {
  const tags = useMemo(() => resolveTagItems(value, options), [value, options])

  return (
    <ItemsListView
      items={tags}
      // `ItemsListView` widens each item to `TagItem | string | number`; `tags` only ever holds
      // `TagItem`s, but a primitive still renders as its own label rather than crashing.
      renderItem={(tag) =>
        typeof tag === 'object' ? (
          <TagBadge tag={tag} variant={variant} />
        ) : (
          <Badge variant={variant} shape='tag'>
            {tag}
          </Badge>
        )
      }
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
      renderItem={(tag) => <TagBadge tag={tag} variant={variant} />}
      className={className}
    />
  )
}
