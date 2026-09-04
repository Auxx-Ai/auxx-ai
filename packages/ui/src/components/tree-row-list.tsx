// packages/ui/src/components/tree-row-list.tsx
'use client'

import { AnimatedCollapsibleContent } from '@auxx/ui/components/collapsible'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Fragment, type ReactNode, useState } from 'react'

export interface TreeRowListProps<T> {
  /** The rows' backing data, in render order. */
  items: T[]
  /** Renders one row — typically a {@link TreeRow} or a wrapper around it. */
  renderRow: (item: T, index: number) => ReactNode
  /** Stable React key per item. */
  getKey: (item: T, index: number) => string
  /**
   * Cap the always-visible rows; anything past it collapses behind an inline
   * "Show N more" toggle row that expands in place. Omit (or 0) to show all.
   */
  visibleLimit?: number
  /** Render `skeletonCount` placeholder rows instead of the items. */
  loading?: boolean
  /** Placeholder-row count while `loading`. */
  skeletonCount?: number
  /** Leading icon for the "Show N more" / "Show less" toggle row. */
  showMoreIcon?: ReactNode
  /** Override the collapsed label (default: `Show {n} more`). */
  showMoreLabel?: (hiddenCount: number) => string
  /** Class for the outer container (rows are stacked with `flex flex-col`). */
  className?: string
}

/**
 * TreeRowList — the shared "list of {@link TreeRow}s with an inline show-more
 * collapse and loading placeholders" primitive. The first {@link
 * TreeRowListProps.visibleLimit} rows always render; the remainder are siblings
 * inside an animated collapse (so they keep the flat-list indentation) behind a
 * "Show N more" toggle. Row rendering is caller-owned via `renderRow`, so this
 * stays row-type-agnostic (connector runs, work-order visits, …); groups/headers
 * are the caller's job — render one list per group.
 */
export function TreeRowList<T>({
  items,
  renderRow,
  getKey,
  visibleLimit,
  loading = false,
  skeletonCount = 3,
  showMoreIcon,
  showMoreLabel,
  className,
}: TreeRowListProps<T>) {
  const [showAll, setShowAll] = useState(false)

  if (loading) {
    return (
      <div className={cn('flex flex-col', className)}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <TreeRowSkeleton key={i} />
        ))}
      </div>
    )
  }

  const limit = visibleLimit && visibleLimit > 0 ? visibleLimit : items.length
  const visible = items.slice(0, limit)
  const hidden = items.slice(limit)

  return (
    <div className={cn('flex flex-col', className)}>
      {visible.map((item, i) => (
        <Fragment key={getKey(item, i)}>{renderRow(item, i)}</Fragment>
      ))}

      {hidden.length > 0 && (
        <>
          {/* `gap-[inherit]` so the revealed rows sit at the SAME spacing as the
              first `visibleLimit` ones. The collapse is its own flex container,
              so without this a caller's `gap-*` on the outer container reaches
              the collapse as a flex ITEM but never its children, and everything
              behind "Show N more" rendered flush. Inheriting the parent's gap is
              exact: it copies the one property that differs and leaves any
              padding the caller set on the outer container alone. */}
          <AnimatedCollapsibleContent open={showAll} className='flex flex-col gap-[inherit]'>
            {hidden.map((item, i) => (
              <Fragment key={getKey(item, limit + i)}>{renderRow(item, limit + i)}</Fragment>
            ))}
          </AnimatedCollapsibleContent>
          <TreeRow
            icon={showMoreIcon}
            title={
              showAll
                ? 'Show less'
                : (showMoreLabel?.(hidden.length) ?? `Show ${hidden.length} more`)
            }
            rowClassName='hover:bg-primary-100'
            expandable
            isOpen={showAll}
            onToggleOpen={() => setShowAll((v) => !v)}
          />
        </>
      )}
    </div>
  )
}
