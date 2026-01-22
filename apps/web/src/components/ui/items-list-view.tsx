// apps/web/src/components/ui/items-list-view.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { CellSelectionOverlay } from '../dynamic-table/components/cell-selection-overlay'

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
 * Props for ItemsListView (simple view, no table cell features)
 */
export interface ItemsListViewProps<T extends ItemsListItem> {
  /** Array of items to render */
  items: T[]
  /** Render function for each item */
  renderItem: ItemRenderer<T>
  /** Content to show when items is empty */
  emptyContent?: React.ReactNode
  /** Additional className for container */
  className?: string
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
}

/**
 * ItemsListView - Simple view for rendering a list of items as badges
 * Use for non-table contexts (drawers, forms, etc.)
 */
export function ItemsListView<T extends ItemsListItem>({
  items,
  renderItem,
  emptyContent = null,
  className,
}: ItemsListViewProps<T>) {
  if (items.length === 0) {
    return emptyContent
  }

  return (
    <div className={cn('relative w-full flex items-center', className)}>
      <div className="flex items-center gap-1 py-0.5">
        {items.map((item, index) => (
          <div key={item.id} className="shrink-0">
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ItemsCellView - Table cell view with expandable hover
 * Use for dynamic table cells that need to show single or multiple items
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
}: ItemsCellViewProps<T>) {
  // Normalize to array: use items if provided, otherwise wrap single item
  // Primitives (string/number/boolean) are wrapped as { id: String(value) }
  const normalizedItems: T[] =
    items ?? (item != null ? [typeof item === 'object' ? item : ({ id: String(item) } as T)] : [])

  // Empty state
  if (!isLoading && normalizedItems.length === 0) {
    return (
      <div
        data-slot="expandable-cell-inner"
        className={cn('relative w-full min-h-9 flex items-center ps-3', className)}>
        {emptyContent ?? <span className="text-muted-foreground">-</span>}
        <div className="hidden [.cell-selected_&]:flex">
          <CellSelectionOverlay isSelected isEditing={false} />
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading && normalizedItems.length === 0) {
    return (
      <div
        data-slot="expandable-cell-inner"
        className={cn('relative w-full min-h-9 flex items-center ps-3 gap-1', className)}>
        {Array.from({ length: loadingCount }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-16 rounded" />
        ))}
      </div>
    )
  }

  return (
    <div
      data-slot="expandable-cell-inner"
      className={cn('relative min-w-full w-full min-h-9 group/items-list flex text-sm', className)}>
      {/* Items */}
      <div className="flex items-center gap-1 w-full overflow-hidden ps-3 py-0.5 px-0.5 shrink-0 mask-r-from-[calc(100%-32px)] mask-r-to-[100%]">
        {normalizedItems.map((item, index) => (
          <div key={item.id} className="shrink-0">
            {renderItem(item, index)}
          </div>
        ))}
      </div>

      {/* Fade overlay - slides out on hover/selection */}
      {/* <div
        className={cn(
          'absolute inset-y-0 right-0 w-12 pointer-events-none z-10',
          // 'bg-white dark:bg-background',
          'mask-r-from-20',
          'transition-transform duration-200 ease-out',
          'group-hover/tablecell:translate-x-full',
          '[.cell-selected_&]:translate-x-full'
        )}></div> */}

      {/* Expanded view - shows when cell is selected */}
      <div
        data-self-overlay
        data-slot="expandable-cell-inner"
        className={cn(
          'absolute left-0 top-0 z-15 min-h-9',
          'hidden [.cell-selected_&]:flex',
          'ps-3 px-3',
          'min-w-full w-max max-w-xs',
          'bg-primary-100'
        )}>
        <CellSelectionOverlay isSelected isEditing={false} />
        <div className="my-2">
          <div className="flex flex-wrap gap-1">
            {normalizedItems.map((item, index) => (
              <div key={`expanded-${item.id}`} className="shrink-0">
                {renderItem(item, index)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
