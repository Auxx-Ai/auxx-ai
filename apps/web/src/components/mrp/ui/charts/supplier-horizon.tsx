// apps/web/src/components/mrp/ui/charts/supplier-horizon.tsx
'use client'

import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { type ChartConfig, ChartContainer } from '@auxx/ui/components/chart'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { EmptySection, SECTION_BLEED, Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { memo, type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import { ComposedChart, Customized, ReferenceLine, XAxis, YAxis } from 'recharts'
import { PaginatedLegend, type PaginatedLegendItem } from '~/components/charts/paginated-legend'
import {
  type ChartAxis,
  FadeTick,
  type PlotOffset,
  TWEEN_MS,
  tickSets,
  usePreviousDistinct,
} from '~/components/charts/tween-axis'
import { useResourceProperty } from '~/components/resources'
import { RecordLink } from '~/components/resources/ui/record-link'
import { useIsMobile } from '~/hooks/use-mobile'
import { useTween } from '~/hooks/use-tween'
import { api } from '~/trpc/react'
import { dayToT, formatDay, formatMonth, tToDay, xTicks } from './position-chart-data'
import {
  buildHorizonLanes,
  HORIZON_WINDOWS,
  type HorizonLane,
  type HorizonMark,
  type HorizonTip,
  type HorizonWindow,
  horizonExtent,
  mergeLanes,
  type SupplierHorizonData,
} from './supplier-horizon-data'

export interface SupplierHorizonChartProps {
  supplierId: string
  runId?: string | null
  /** `section` is the drawer: narrower labels, six part lanes, no cycle ticks. */
  variant?: 'page' | 'section'
  /** Inside a card that already has a title: no `Section`, controls in a toolbar row. */
  bare?: boolean
}

const LINE = 'var(--blue-9)'
const MUTED = 'var(--gray-8)'
const MUTED_TEXT = 'var(--muted-foreground)'
const SURFACE = 'var(--background)'
const RECEIVED_OPACITY = 0.4
const LANE_PX = 22
const MIN_PLOT = 72
const MAX_PLOT = 400
const TOP = 14
const AXIS = 24
const BAR = 10
const HIT = 24

const chartConfig = {} satisfies ChartConfig

/** One supplier's POs, next order and part order-by/stockout dates on one time axis (16 §3). */
export function SupplierHorizonChart({
  supplierId,
  runId,
  variant = 'page',
  bare = false,
}: SupplierHorizonChartProps) {
  const [range, setRange] = useState<HorizonWindow>('6m')
  const [offset, setOffset] = useState(0)

  const { data, isLoading, error } = api.mrp.supplierHorizon.useQuery(
    { supplierId, window: range, runId, offset },
    { placeholderData: keepPreviousData }
  )
  const utils = api.useUtils()
  useEffect(() => {
    if (!data) return
    const base = { supplierId, window: range, runId }
    if (data.hasEarlier) void utils.mrp.supplierHorizon.prefetch({ ...base, offset: offset + 1 })
    if (offset > 0) void utils.mrp.supplierHorizon.prefetch({ ...base, offset: offset - 1 })
  }, [data, supplierId, range, runId, offset, utils])

  const compact = variant === 'section'
  const setWindow = (value: HorizonWindow) => {
    setRange(value)
    setOffset(0)
  }
  const period = data ? `${formatMonth(data.from)} – ${formatMonth(data.to)}` : null
  const windowLabel = HORIZON_WINDOWS.find((w) => w.value === range)?.label
  const empty =
    !!data &&
    offset === 0 &&
    !data.hasEarlier &&
    data.orders.length === 0 &&
    data.parts.length === 0 &&
    !data.nextOrder

  const controls = (
    <div className='flex items-center gap-2'>
      {period && (
        <span className='hidden text-xs text-muted-foreground tabular-nums @xl:inline'>
          {period}
        </span>
      )}
      <div className='flex items-center gap-0.5'>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Earlier'
          className='disabled:opacity-20'
          disabled={!data?.hasEarlier}
          onClick={() => setOffset((o) => o + 1)}>
          <ChevronLeft />
        </Button>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Later'
          className='disabled:opacity-20'
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - 1))}>
          <ChevronRight />
        </Button>
      </div>
      <div className='hidden @3xl:flex'>
        <RadioTab size='sm' value={range} onValueChange={(v) => setWindow(v as HorizonWindow)}>
          {HORIZON_WINDOWS.map((w) => (
            <RadioTabItem key={w.value} value={w.value} size='sm'>
              {w.label}
            </RadioTabItem>
          ))}
        </RadioTab>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='xs' className='@3xl:hidden'>
            {windowLabel}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {period && (
            <DropdownMenuLabel className='font-normal text-muted-foreground tabular-nums'>
              {period}
            </DropdownMenuLabel>
          )}
          <DropdownMenuLabel>Window</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={range}
            onValueChange={(v) => setWindow(v as HorizonWindow)}>
            {HORIZON_WINDOWS.map((w) => (
              <DropdownMenuRadioItem key={w.value} value={w.value}>
                {w.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const inset = bare ? undefined : 'mx-3'
  const body = isLoading ? (
    <EmptySection loading className={inset} />
  ) : error ? (
    <EmptySection
      className={inset}
      title='Could not load the horizon'
      description={error.message}
    />
  ) : !data || empty ? (
    <EmptySection className={inset} title='Nothing ordered from this supplier yet' />
  ) : (
    <HorizonPlot key={supplierId} data={data} compact={compact} padded={!bare && !compact} />
  )

  if (bare) {
    return (
      <div className='@container flex flex-col gap-2'>
        <div className='flex justify-end'>{controls}</div>
        {body}
      </div>
    )
  }
  return (
    <Section title='Horizon' className={cn('@container', SECTION_BLEED)} actions={controls}>
      {body}
    </Section>
  )
}

/** The hovered mark and where its tooltip anchors, in plot-container pixels. */
interface Hover {
  key: string
  tip: HorizonTip
  x: number
  top: number
  bottom: number
  below: boolean
}

// Memoised so a window click doesn't redraw the old data before the new query lands.
const HorizonPlot = memo(function HorizonPlot({
  data,
  compact,
  padded,
}: {
  data: SupplierHorizonData
  compact: boolean
  padded: boolean
}) {
  const isMobile = useIsMobile()
  const hatchId = `hatch-${useId().replace(/:/g, '')}`
  const calendarToday = new Date().toLocaleDateString('en-CA')
  const today = data.runAsOf ?? calendarToday
  const lanes = useMemo(
    () => buildHorizonLanes(data, { today, compact, mobile: isMobile }),
    [data, today, compact, isMobile]
  )
  const prevLanes = usePreviousDistinct(lanes)

  // The x scale tweens, not the marks: a page step scrolls the lanes and a window change zooms them.
  const target = useMemo(() => horizonExtent(data), [data])
  const tween = useTween(target, TWEEN_MS)
  // Also true on the frame new data lands, before the tween's first tick, so old marks don't flash out.
  const moving = tween.progress < 1 || tween.to.join(',') !== target.join(',')
  const [xLo, xHi] = tween.current as [number, number]
  const drawn = useMemo(
    () => (moving && prevLanes ? mergeLanes(prevLanes, lanes) : lanes),
    [moving, prevLanes, lanes]
  )
  const [hover, setHover] = useState<Hover | null>(null)
  const shownHover = moving ? null : hover

  const laneCount = Math.max(1, drawn.length)
  const plotHeight = Math.min(MAX_PLOT, Math.max(MIN_PLOT, laneCount * LANE_PX))
  const laneHeight = plotHeight / laneCount
  const height = TOP + plotHeight + AXIS
  const wide = xHi - xLo > 200
  const xAxis = tickSets(tween, 0, (lo, hi) => xTicks(lo, hi, compact || isMobile ? 4 : 8))
  const formatTick = (t: number) => {
    const day = tToDay(t)
    return wide ? `${formatMonth(day).slice(0, 3)} '${day.slice(2, 4)}` : formatDay(day)
  }

  // Array, not a fragment: recharts only scans direct children (see line-chart-widget.tsx).
  const layers = [
    <XAxis
      key='x'
      dataKey='t'
      type='number'
      domain={[xLo, xHi]}
      allowDataOverflow
      ticks={xAxis.ticks}
      interval={0}
      height={AXIS}
      tickLine={false}
      axisLine={false}
      tickMargin={6}
      tick={(props) => <FadeTick {...props} opacity={xAxis.opacity} format={formatTick} />}
    />,
    <YAxis
      key='y'
      dataKey='lane'
      type='number'
      domain={[0, laneCount]}
      allowDataOverflow
      reversed
      hide
    />,
    <Customized
      key='lanes'
      component={
        <LanesLayer
          lanes={drawn}
          hatchId={hatchId}
          hovered={shownHover?.key ?? null}
          interactive={!moving}
          onHover={setHover}
        />
      }
    />,
    <ReferenceLine
      key='today'
      x={dayToT(today)}
      stroke='var(--gray-10)'
      label={{
        value: today === calendarToday ? 'Today' : `Run ${formatDay(today)}`,
        position: 'top',
        fill: MUTED_TEXT,
        fontSize: 10,
      }}
    />,
  ]

  return (
    <div className={cn('flex flex-col gap-2', padded && 'px-3')}>
      <div className='flex' style={{ height }}>
        <LaneLabels
          lanes={lanes}
          laneHeight={laneHeight}
          className={compact || isMobile ? 'w-24' : 'w-40'}
        />
        <div className='relative min-w-0 flex-1'>
          <ChartContainer config={chartConfig} className='aspect-auto h-full w-full'>
            <ComposedChart
              data={[
                { t: target[0], lane: 0 },
                { t: target[1], lane: laneCount },
              ]}
              margin={{ top: TOP, right: 8, left: 0, bottom: 0 }}>
              {layers}
            </ComposedChart>
          </ChartContainer>
          {shownHover && <MarkTooltip hover={shownHover} />}
        </div>
      </div>
      <HorizonLegend lanes={lanes} noPlan={data.runAsOf === null} hatchId={hatchId} />
    </div>
  )
})

/** The HTML lane-label column; PO and part names link to their records. */
function LaneLabels({
  lanes,
  laneHeight,
  className,
}: {
  lanes: HorizonLane[]
  laneHeight: number
  className: string
}) {
  const poDefId = useResourceProperty('purchase_order', 'id')
  const partDefId = useResourceProperty('part', 'id')
  const defIds = { purchase_order: poDefId, part: partDefId }
  return (
    <div
      className={cn('grid shrink-0 content-start pr-2', className)}
      style={{ paddingTop: TOP, gridTemplateRows: `repeat(${lanes.length}, ${laneHeight}px)` }}>
      {lanes.map((lane) => {
        const defId = lane.record ? defIds[lane.record.definition] : undefined
        const recordId =
          lane.record && defId ? (toRecordId(defId, lane.record.id) as RecordId) : null
        return (
          <div key={lane.key} className='flex min-w-0 items-center gap-1 text-xs'>
            {lane.record ? (
              <RecordLink
                recordId={recordId}
                openInStack
                className={cn('truncate', lane.wontMake && 'text-muted-foreground')}>
                {lane.label}
              </RecordLink>
            ) : (
              <span
                className={cn(
                  'truncate',
                  (lane.kind === 'orders' || lane.kind === 'more') && 'text-muted-foreground'
                )}>
                {lane.label}
              </span>
            )}
            {lane.wontMake && (
              <Badge variant='amber' size='xs' className='shrink-0'>
                Late
              </Badge>
            )}
            {lane.pulls && !lane.wontMake && (
              <span className='shrink-0 text-muted-foreground'>· pulls</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Right-rounded bar: square at the order date, a 4px round at the data end. */
function barPath(x0: number, x1: number, y: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, h / 2, x1 - x0) : 0
  return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x1 - r},${y + h}H${x0}Z`
}

/** Every lane's marks in one SVG layer, plus wider invisible hit targets; `Customized` passes the axis maps. */
function LanesLayer({
  lanes,
  hatchId,
  hovered,
  interactive,
  onHover,
  xAxisMap,
  yAxisMap,
  offset,
}: {
  lanes: HorizonLane[]
  hatchId: string
  hovered: string | null
  interactive: boolean
  onHover: (hover: Hover | null) => void
  xAxisMap?: Record<string, ChartAxis>
  yAxisMap?: Record<string, ChartAxis>
  offset?: PlotOffset
}) {
  const x = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  const y = yAxisMap ? Object.values(yAxisMap)[0] : undefined
  if (!x || !y || !offset) return null
  const plotLeft = offset.left
  const plotRight = offset.left + offset.width
  const inPlot = (px: number) => px >= plotLeft - 0.5 && px <= plotRight + 0.5

  /** A day span in pixels, clipped to the plot; null when it falls outside. */
  const span = (from: number, to: number) => {
    const a = x.scale(from - 0.5)
    const b = Math.max(x.scale(to + 0.5), a + 2)
    const x0 = Math.max(plotLeft, a)
    const x1 = Math.min(plotRight, b)
    return x1 - x0 > 0.5 ? { x0, x1, clipped: b > plotRight } : null
  }

  const marks: ReactNode[] = []
  const hits: ReactNode[] = []
  lanes.forEach((lane, i) => {
    const top = y.scale(i)
    const laneH = y.scale(i + 1) - top
    const cy = top + laneH / 2
    const barH = Math.min(BAR, laneH - 4)
    const barY = cy - barH / 2
    const hit = (mark: HorizonMark & { tip: HorizonTip }, x0: number, x1: number) => {
      const w = Math.max(HIT, x1 - x0)
      const left = Math.max(plotLeft, (x0 + x1) / 2 - w / 2)
      const right = Math.min(plotRight, left + w)
      const show = () =>
        onHover({
          key: mark.key,
          tip: mark.tip,
          x: (Math.max(plotLeft, x0) + Math.min(plotRight, x1)) / 2,
          top,
          bottom: top + laneH,
          below: i < 2,
        })
      hits.push(
        <rect
          key={`hit:${lane.key}:${mark.key}`}
          x={left}
          y={top}
          width={Math.max(0, right - left)}
          height={laneH}
          fill='transparent'
          tabIndex={interactive ? 0 : -1}
          aria-label={mark.tip.title}
          onPointerEnter={show}
          onPointerLeave={() => onHover(null)}
          onFocus={show}
          onBlur={() => onHover(null)}
        />
      )
    }
    const dot = (key: string, cx: number, fill: string, hollow: boolean, opacity = 1) => (
      <g key={key}>
        <circle cx={cx} cy={cy} r={6} fill={SURFACE} />
        <circle
          cx={cx}
          cy={cy}
          r={hollow ? 3.5 : 4.5}
          fill={hollow ? SURFACE : fill}
          fillOpacity={hollow ? 1 : opacity}
          stroke={hollow ? fill : 'none'}
          strokeWidth={2}
        />
      </g>
    )

    const laneMarks: ReactNode[] = []
    if (lane.marks.some((m) => m.key === hovered)) {
      laneMarks.push(
        <rect
          key='band'
          x={plotLeft}
          y={top}
          width={offset.width}
          height={laneH}
          fill='var(--gray-a3)'
        />
      )
    }
    for (const mark of lane.marks) {
      const k = mark.key
      if (mark.kind === 'bar') {
        const s = span(mark.from, mark.to)
        if (!s) continue
        laneMarks.push(
          <path
            key={k}
            d={barPath(s.x0, s.x1, barY, barH, !s.clipped)}
            fill={LINE}
            fillOpacity={mark.tone === 'received' ? RECEIVED_OPACITY : 1}
          />
        )
        hit(mark, s.x0, s.x1)
      } else if (mark.kind === 'overdue') {
        // 2px surface gap after the open bar it extends.
        const s = span(mark.from + 1 + 2 / Math.max(0.01, x.scale(1) - x.scale(0)), mark.to)
        if (!s) continue
        laneMarks.push(
          <path key={k} d={barPath(s.x0, s.x1, barY, barH, !s.clipped)} fill={`url(#${hatchId})`} />
        )
        hit(mark, s.x0, s.x1)
      } else if (mark.kind === 'next') {
        const s = span(mark.from, mark.to)
        if (!s) continue
        laneMarks.push(
          <path
            key={k}
            d={barPath(s.x0 + 0.75, s.x1 - 0.75, barY + 0.75, barH - 1.5, !s.clipped)}
            fill={LINE}
            fillOpacity={0.12}
            stroke={LINE}
            strokeWidth={1.5}
            strokeDasharray='4 3'
          />
        )
        hit(mark, s.x0, s.x1)
      } else if (mark.kind === 'dot') {
        const cx = x.scale(mark.t)
        if (!inPlot(cx)) continue
        laneMarks.push(dot(k, cx, LINE, false, lane.kind === 'orders' ? RECEIVED_OPACITY + 0.2 : 1))
        hit(mark, cx, cx)
      } else if (mark.kind === 'tick') {
        const cx = x.scale(mark.t)
        if (!inPlot(cx)) continue
        laneMarks.push(
          <line
            key={k}
            x1={cx}
            x2={cx}
            y1={cy + barH / 2 + 1}
            y2={cy + laneH / 2 - 1}
            stroke={MUTED}
            strokeWidth={1}
          />
        )
      } else if (mark.kind === 'rhythm') {
        const cx = x.scale(mark.t)
        if (!inPlot(cx)) continue
        laneMarks.push(
          <line
            key={k}
            x1={cx}
            x2={cx}
            y1={top + 2}
            y2={top + laneH - 2}
            stroke='var(--gray-10)'
            strokeWidth={1.5}
            strokeDasharray='2 2'
          />
        )
        hit(mark, cx, cx)
      } else if (mark.kind === 'dumbbell') {
        const tone = mark.muted ? MUTED : LINE
        const a = mark.from === null ? null : x.scale(mark.from)
        const b = mark.to === null ? null : x.scale(mark.to)
        if (a !== null && b !== null) {
          const x0 = Math.max(plotLeft, Math.min(a, b))
          const x1 = Math.min(plotRight, Math.max(a, b))
          if (x1 > x0) {
            laneMarks.push(
              <line
                key={`${k}:stem`}
                x1={x0}
                x2={x1}
                y1={cy}
                y2={cy}
                stroke={tone}
                strokeWidth={2}
              />
            )
          }
        }
        if (b !== null && inPlot(b)) laneMarks.push(dot(`${k}:to`, b, tone, true))
        if (a !== null && inPlot(a)) laneMarks.push(dot(`${k}:from`, a, tone, false))
        const ends = [a, b].filter((v): v is number => v !== null && inPlot(v))
        if (ends.length > 0) hit(mark, Math.min(...ends), Math.max(...ends))
      }
    }
    marks.push(<g key={lane.key}>{laneMarks}</g>)
  })

  return (
    <g>
      <defs>
        <pattern
          id={hatchId}
          patternUnits='userSpaceOnUse'
          width={4}
          height={4}
          patternTransform='rotate(45)'>
          <rect width={4} height={4} fill='var(--gray-4)' />
          <line x1={0} y1={0} x2={0} y2={4} stroke='var(--gray-8)' strokeWidth={1.5} />
        </pattern>
      </defs>
      {marks}
      {interactive && <g>{hits}</g>}
    </g>
  )
}

function MarkTooltip({ hover }: { hover: Hover }) {
  return (
    <div
      className='pointer-events-none absolute z-10 grid min-w-32 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl'
      style={{
        left: hover.x,
        top: hover.below ? hover.bottom + 4 : hover.top - 4,
        transform: `translate(-50%, ${hover.below ? '0' : '-100%'})`,
      }}>
      <div className='font-medium'>{hover.tip.title}</div>
      {hover.tip.rows.map(([label, value]) => (
        <div key={`${label}:${value}`} className='flex items-center justify-between gap-3'>
          {label && <span className='text-muted-foreground'>{label}</span>}
          <span
            className={cn(
              'tabular-nums',
              label ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}>
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

function HorizonLegend({
  lanes,
  noPlan,
  hatchId,
}: {
  lanes: HorizonLane[]
  noPlan: boolean
  hatchId: string
}) {
  const marks = lanes.flatMap((l) => l.marks)
  const has = (pred: (m: HorizonMark) => boolean) => marks.some(pred)
  const dumbbells = marks.filter((m) => m.kind === 'dumbbell')
  const items: (PaginatedLegendItem | false)[] = [
    has((m) => m.kind === 'bar' && m.tone === 'received') && {
      key: 'received',
      node: (
        <LegendKey label='Received'>
          <span
            className='h-2.5 w-3 rounded-r-[2px]'
            style={{ background: LINE, opacity: RECEIVED_OPACITY }}
          />
        </LegendKey>
      ),
    },
    has((m) => m.kind === 'bar' && m.tone === 'open') && {
      key: 'open',
      node: (
        <LegendKey label='Open'>
          <span className='h-2.5 w-3 rounded-r-[2px]' style={{ background: LINE }} />
        </LegendKey>
      ),
    },
    has((m) => m.kind === 'overdue') && {
      key: 'overdue',
      node: (
        <LegendKey label='Overdue, projected'>
          <svg className='h-2.5 w-3' aria-hidden='true'>
            <rect width='100%' height='100%' fill={`url(#${hatchId})`} />
          </svg>
        </LegendKey>
      ),
    },
    has((m) => m.kind === 'next') && {
      key: 'next',
      node: (
        <LegendKey label='Next order'>
          <span
            className='h-2.5 w-3 rounded-r-[2px] border-[1.5px] border-dashed'
            style={{ borderColor: LINE }}
          />
        </LegendKey>
      ),
    },
    dumbbells.some((m) => m.kind === 'dumbbell' && m.from !== null) && {
      key: 'orderBy',
      node: (
        <LegendKey label='Order by'>
          <span className='size-2.5 rounded-full' style={{ background: LINE }} />
        </LegendKey>
      ),
    },
    dumbbells.some((m) => m.kind === 'dumbbell' && m.to !== null) && {
      key: 'stockout',
      node: (
        <LegendKey label='Stockout'>
          <span className='size-2.5 rounded-full border-2' style={{ borderColor: LINE }} />
        </LegendKey>
      ),
    },
    has((m) => m.kind === 'rhythm') && {
      key: 'rhythm',
      node: (
        <LegendKey label='Rhythm date'>
          <span
            className='h-2.5 border-l-[1.5px] border-dashed'
            style={{ borderColor: 'var(--gray-10)' }}
          />
        </LegendKey>
      ),
    },
    has((m) => m.kind === 'tick') && {
      key: 'cycle',
      node: (
        <LegendKey label='Order cycle'>
          <span className='h-1.5 border-l' style={{ borderColor: MUTED }} />
        </LegendKey>
      ),
    },
    noPlan && { key: 'noPlan', node: <span>No plan yet</span> },
  ]
  const visible = items.filter((i): i is PaginatedLegendItem => i !== false)
  return <PaginatedLegend items={visible} align='start' />
}

function LegendKey({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className='flex items-center gap-1.5'>
      {children}
      {label}
    </span>
  )
}
