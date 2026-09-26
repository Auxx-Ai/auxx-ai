// apps/web/src/components/charts/paginated-legend.tsx
'use client'

// Twenty-style legend carousel: items on one non-wrapping row, with a `‹ N/M ›`
// paginator that slides between width-fitted pages once they stop fitting.
// Chart-agnostic: callers hand it rendered nodes (see paginated-chart-legend.tsx
// for the recharts adapter, position-chart.tsx for a hand-built legend).

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { binIntoPages } from './legend-pages'

/** Gap between legend items, in px. Must match the flex `gap` below. */
const ITEM_GAP = 12
/** Width the paginator reserves when items don't all fit on one row, in px. */
const PAGINATOR_WIDTH = 84

export type PaginatedLegendItem = { key: string; node: ReactNode }

export function PaginatedLegend({
  items,
  align = 'center',
  className,
}: {
  items: PaginatedLegendItem[]
  /** Where a page's items sit when they don't fill the row. */
  align?: 'start' | 'center'
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [itemWidths, setItemWidths] = useState<number[]>([])
  const [page, setPage] = useState(0)

  // Container width via ResizeObserver on our own root (recharts sizes the
  // legend wrapper to the chart width).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    setContainerWidth(Math.floor(el.getBoundingClientRect().width))
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(Math.floor(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Measure each item's natural width from the hidden pass. `items` is the
  // re-measure trigger, even though the body reads the DOM, not `items` directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger dep
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const widths = Array.from(el.children).map((c) => (c as HTMLElement).offsetWidth)
    setItemWidths((prev) =>
      prev.length === widths.length && prev.every((w, i) => w === widths[i]) ? prev : widths
    )
  }, [items])

  const pages = useMemo(
    () => binIntoPages(itemWidths, containerWidth, PAGINATOR_WIDTH, ITEM_GAP),
    [itemWidths, containerWidth]
  )

  // Clamp the active page when a resize collapses the page count.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, pages.length - 1)))
  }, [pages.length])

  if (!items.length) return null

  const showPaginator = pages.length > 1
  const atFirst = page <= 0
  const atLast = page >= pages.length - 1
  const justify = align === 'start' ? 'justify-start' : 'justify-center'

  return (
    <div
      ref={rootRef}
      className={cn('flex h-6 w-full items-center gap-2 text-muted-foreground text-xs', className)}>
      {/* Hidden measure pass — same markup as the visible items so widths match. */}
      <div
        ref={measureRef}
        aria-hidden
        className='pointer-events-none invisible absolute flex w-max'
        style={{ gap: ITEM_GAP }}>
        {items.map((item) => (
          <span key={item.key} className='shrink-0 whitespace-nowrap'>
            {item.node}
          </span>
        ))}
      </div>

      {showPaginator && (
        <div className='flex shrink-0 items-center gap-0.5'>
          <Button
            variant='ghost'
            size='icon-xs'
            disabled={atFirst}
            aria-label='Previous legend page'
            onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft />
          </Button>
          <span className='min-w-8 text-center tabular-nums'>
            {page + 1}/{pages.length}
          </span>
          <Button
            variant='ghost'
            size='icon-xs'
            disabled={atLast}
            aria-label='Next legend page'
            onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}>
            <ChevronRight />
          </Button>
        </div>
      )}

      {/* Viewport: one page-wide slide per page, translated into view. */}
      <div className='relative min-w-0 flex-1 overflow-hidden'>
        <div
          className='flex transition-transform duration-200 ease-out motion-reduce:transition-none'
          // translateX % is relative to the track's own width (pages.length
          // viewports wide), so divide by pages.length to slide one viewport per page.
          style={{ transform: `translateX(-${(page * 100) / pages.length}%)` }}>
          {pages.map((pageIndices, pageIdx) => (
            <div
              key={pageIdx}
              className={cn('flex shrink-0 basis-full items-center', justify)}
              style={{ gap: ITEM_GAP }}>
              {pageIndices.map((i) => {
                const item = items[i]
                return item ? (
                  <span key={item.key} className='shrink-0 whitespace-nowrap'>
                    {item.node}
                  </span>
                ) : null
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
