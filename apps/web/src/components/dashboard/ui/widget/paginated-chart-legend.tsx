// apps/web/src/components/dashboard/ui/widget/paginated-chart-legend.tsx
'use client'

// Twenty-style paginated chart legend. Replaces shadcn's single-row
// `ChartLegendContent` (which never wraps and overflows on many series): items
// live on one non-wrapping row with a left `‹ N/M ›` paginator that
// transform-slides between width-fitted pages. Fed as recharts
// `<ChartLegend content={<PaginatedChartLegend />} />`; resolves labels/colors
// from the chart config via the shared `useChart`/`getPayloadConfigFromPayload`.

import { Button } from '@auxx/ui/components/button'
import { getPayloadConfigFromPayload, useChart } from '@auxx/ui/components/chart'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LegendProps } from 'recharts'
import { binIntoPages } from '../../lib/legend-pages'

/** Gap between legend items, in px. Must match the flex `gap` below. */
const ITEM_GAP = 12
/** Width the paginator reserves when items don't all fit on one row, in px. */
const PAGINATOR_WIDTH = 84
/** Max label width before ellipsis, matching Twenty's ~80px cap. */
const LABEL_MAX_WIDTH = 96

type ResolvedItem = { key: string; label: string; color: string }

function LegendSwatch({ color }: { color: string }) {
  return (
    <span
      className='h-2 w-2 shrink-0 rounded-[2px]'
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

/** One swatch + truncated label. Shared by the measure pass and the visible track. */
function LegendItem({ item }: { item: ResolvedItem }) {
  return (
    <span className='flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs'>
      <LegendSwatch color={item.color} />
      <span className='truncate' style={{ maxWidth: LABEL_MAX_WIDTH }} title={item.label}>
        {item.label}
      </span>
    </span>
  )
}

export function PaginatedChartLegend({
  payload,
  nameKey,
  verticalAlign = 'bottom',
}: Pick<LegendProps, 'payload' | 'verticalAlign'> & { nameKey?: string }) {
  const { config } = useChart()

  const items = useMemo<ResolvedItem[]>(() => {
    if (!payload?.length) return []
    return payload.map((item) => {
      const key = `${nameKey || item.dataKey || 'value'}`
      const itemConfig = getPayloadConfigFromPayload(config, item, key)
      const label = itemConfig?.label ?? item.value
      return {
        key: `${item.value}`,
        label: typeof label === 'string' ? label : `${item.value}`,
        color: item.color ?? 'var(--muted-foreground)',
      }
    })
  }, [payload, nameKey, config])

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
  // re-measure trigger (its labels drive the hidden-pass widths), even though the
  // body reads the DOM, not `items` directly.
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

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex h-6 w-full items-center gap-2',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3'
      )}>
      {/* Hidden measure pass — same markup as the visible items so widths match. */}
      <div
        ref={measureRef}
        aria-hidden
        className='pointer-events-none invisible absolute flex w-max'
        style={{ gap: ITEM_GAP }}>
        {items.map((item) => (
          <LegendItem key={item.key} item={item} />
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
          <span className='min-w-8 text-center text-muted-foreground text-xs tabular-nums'>
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
              className='flex shrink-0 basis-full items-center justify-center'
              style={{ gap: ITEM_GAP }}>
              {pageIndices.map((i) => {
                const item = items[i]
                return item ? <LegendItem key={item.key} item={item} /> : null
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
