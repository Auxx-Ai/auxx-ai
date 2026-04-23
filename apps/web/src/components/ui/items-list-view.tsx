// apps/web/src/components/ui/items-list-view.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { ExpandableCell } from '../dynamic-table/components/expandable-cell'
import { useCellActive } from '../dynamic-table/context/cell-active-context'

/**
 * Base item type - must have an id for keying
 */
export interface ItemsListItem {
  id: string
  [key: string]: unknown
}

/**
 * Render function for individual items
 */
export type ItemRenderer<T> = (item: T, index: number) => React.ReactNode

/**
 * Item value for ItemsListView - can be an object with id or a primitive (string/number)
 */
export type ItemsListValue<T extends ItemsListItem> = T | string | number

/**
 * Props for ItemsListView (simple view, no table cell features)
 */
export interface ItemsListViewProps<T extends ItemsListItem> {
  /** Array of items to render (objects with id, or primitives like strings) */
  items: ItemsListValue<T>[]
  /** Render function for each item */
  renderItem: (item: ItemsListValue<T>, index: number) => React.ReactNode
  /** Content to show when items is empty */
  emptyContent?: React.ReactNode
  /** Additional className for container */
  className?: string
  /** Maximum items to display before showing "more" button. Undefined = unlimited */
  maxDisplay?: number
  /** Callback when "more" button is clicked */
  onShowMore?: () => void
}

/**
 * Single item value - can be a full item object or a primitive (string/number/boolean)
 * Primitives are wrapped as { id: String(value) } internally
 */
export type SingleItemValue<T extends ItemsListItem> = T | string | number | boolean

/**
 * Props for ItemsCellView (table cell variant with expandable hover)
 */
export interface ItemsCellViewProps<T extends ItemsListItem> {
  /** Array of items to render (for multiple items) */
  items?: T[]
  /** Single item to render (null/undefined shows empty state). Can be object or primitive. */
  item?: SingleItemValue<T> | null
  /** Render function for each item */
  renderItem: ItemRenderer<T>
  /** Content to show when items is empty */
  emptyContent?: React.ReactNode
  /** Additional className for container */
  className?: string
  /** Show loading skeletons */
  isLoading?: boolean
  /** Number of loading skeletons to show (default: 3) */
  loadingCount?: number
  /** Maximum items to display before showing "+N more". Overflow items render lazily on cell selection. */
  maxDisplay?: number
}

/**
 * Get key from item - handles both objects with id and primitives
 */
function getItemKey<T extends ItemsListItem>(item: ItemsListValue<T>): string {
  return typeof item === 'object' ? item.id : String(item)
}

/**
 * ItemsListView - Simple view for rendering a list of items as badges
 * Use for non-table contexts (drawers, forms, etc.)
 *
 * Supports both object items (with id property) and primitives (strings/numbers).
 *
 * @example Object items
 * <ItemsListView items={users} renderItem={(user) => <UserBadge user={user} />} />
 *
 * @example Primitive items (e.g., ActorId strings)
 * <ItemsListView items={actorIds} renderItem={(id) => <ActorBadge actorId={id} />} />
 */
export function ItemsListView<T extends ItemsListItem>({
  items,
  renderItem,
  emptyContent = null,
  className,
  maxDisplay,
  onShowMore,
}: ItemsListViewProps<T>) {
  if (items.length === 0) {
    return emptyContent
  }

  const displayItems = maxDisplay != null ? items.slice(0, maxDisplay) : items
  const remainingCount = maxDisplay != null ? items.length - maxDisplay : 0

  return (
    <div className={cn('relative w-full flex items-center', className)}>
      <div className='flex items-center gap-1 py-0.5 shrink-0'>
        {displayItems.map((item, index) => (
          <div key={getItemKey(item)} className='shrink-0'>
            {renderItem(item, index)}
          </div>
        ))}
        {remainingCount > 0 && (
          <button
            type='button'
            onClick={onShowMore}
            className='shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors'>
            +{remainingCount} more
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * ItemsCellView - Table cell view with expandable hover.
 *
 * Renders the item list once. Layout (single-line + fade mask vs. flex-wrap)
 * is driven by the parent `.cell-active` class via `ExpandableCell` mode='items'.
 *
 * When `maxDisplay` is set, overflow items are mounted only when the cell is
 * active — same lazy-mount perf trick as before, but driven by `useCellActive`
 * (single context subscription) instead of a per-cell `MutationObserver`.
 *
 * @example Single item usage:
 * <ItemsCellView
 *   item={{ id: status }}
 *   renderItem={() => <StatusBadge status={status} />}
 * />
 *
 * @example Multiple items usage:
 * <ItemsCellView
 *   items={tags}
 *   renderItem={(tag) => <Badge>{tag.label}</Badge>}
 * />
 */
export function ItemsCellView<T extends ItemsListItem>({
  items,
  item,
  renderItem,
  emptyContent,
  isLoading = false,
  loadingCount = 3,
  className,
  maxDisplay,
}: ItemsCellViewProps<T>) {
  const { isActive } = useCellActive()

  // Normalize to array: use items if provided, otherwise wrap single item.
  // Primitives (string/number/boolean) are wrapped as { id: String(value) }.
  const normalizedItems: T[] =
    items ?? (item != null ? [typeof item === 'object' ? item : ({ id: String(item) } as T)] : [])

  // Loading state — render skeletons in the same wrapper.
  if (isLoading && normalizedItems.length === 0) {
    return (
      <ExpandableCell mode='items' className={className}>
        {Array.from({ length: loadingCount }).map((_, i) => (
          <Skeleton key={i} className='h-5 w-16 rounded' />
        ))}
      </ExpandableCell>
    )
  }

  // Empty state — render the empty content in the same wrapper.
  if (normalizedItems.length === 0) {
    return (
      <ExpandableCell mode='items' className={className}>
        {emptyContent ?? <span className='text-muted-foreground'>-</span>}
      </ExpandableCell>
    )
  }

  // Lazy-mount overflow: when collapsed and over the cap, only render the cap.
  // When the cell becomes active, render all of them.
  const hasOverflow = maxDisplay != null && normalizedItems.length > maxDisplay
  const visibleItems =
    hasOverflow && !isActive ? normalizedItems.slice(0, maxDisplay) : normalizedItems
  const overflowCount = hasOverflow && !isActive ? normalizedItems.length - maxDisplay : 0

  return (
    <ExpandableCell mode='items' className={className}>
      {visibleItems.map((it, index) => (
        <div key={it.id} className='shrink-0'>
          {renderItem(it, index)}
        </div>
      ))}
      {overflowCount > 0 && (
        <span className='shrink-0 text-xs text-muted-foreground'>+{overflowCount}</span>
      )}
    </ExpandableCell>
  )
}
