// apps/web/src/components/mrp/ui/charts/position-chart.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { EmptySection, SECTION_BLEED, Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { memo, type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { PaginatedLegend, type PaginatedLegendItem } from '~/components/charts/paginated-legend'
import {
  type ChartAxis,
  FadeTick,
  type PlotOffset,
  TWEEN_MS,
  tickSets,
  usePreviousDistinct,
} from '~/components/charts/tween-axis'
import { useIsMobile } from '~/hooks/use-mobile'
import { useTween } from '~/hooks/use-tween'
import { api } from '~/trpc/react'
import {
  buildPositionRows,
  dayToT,
  defaultGrain,
  formatDay,
  formatMonth,
  formatQty,
  grainAllowed,
  mergeRows,
  niceTicks,
  type PartSeriesData,
  POSITION_GRAINS,
  POSITION_WINDOWS,
  type PositionGrain,
  type PositionRow,
  type PositionWindow,
  stockoutRuns,
  tToDay,
  type UsageSpan,
  usageSpans,
  xExtent,
  xTicks,
  yExtents,
} from './position-chart-data'

export interface PositionChartProps {
  partId: string
  runId?: string | null
  /** `section` is the docked drawer: controls stack, margins go to zero, axes sit inside the plot. */
  variant?: 'page' | 'section'
}

const LINE = 'var(--blue-9)'
const USED = 'var(--gray-8)'
const MUTED_TEXT = 'var(--muted-foreground)'
const STOCKOUT = 'var(--red-9)'
const STOCKOUT_STRIP = 3

const chartConfig = {
  onHand: { label: 'On hand', color: LINE },
  projected: { label: 'Projected', color: LINE },
  used: { label: 'Used', color: USED },
  projectedUse: { label: 'Projected use', color: 'var(--gray-6)' },
} satisfies ChartConfig

const ZONES = [
  { key: 'red', label: 'Red', color: 'var(--red-9)' },
  { key: 'yellow', label: 'Yellow', color: 'var(--amber-9)' },
  { key: 'green', label: 'Green', color: 'var(--green-9)' },
] as const

/** The Planning tab's Position section (07 §5.1): ledger on hand, projected depletion, usage bars and zones. */
export function PositionChart({ partId, runId, variant = 'page' }: PositionChartProps) {
  const [range, setRange] = useState<PositionWindow>('6m')
  const [grainOverride, setGrainOverride] = useState<PositionGrain | null>(null)
  const [offset, setOffset] = useState(0)
  const grain = grainOverride ?? defaultGrain(range)

  const { data, isLoading, error } = api.mrp.partSeries.useQuery(
    { partId, window: range, grain, runId, offset },
    { placeholderData: keepPreviousData }
  )
  // Neighbouring pages warm so a step slides at once instead of after the round trip.
  const utils = api.useUtils()
  useEffect(() => {
    if (!data) return
    const base = { partId, window: range, grain, runId }
    if (data.hasEarlier) void utils.mrp.partSeries.prefetch({ ...base, offset: offset + 1 })
    if (offset > 0) void utils.mrp.partSeries.prefetch({ ...base, offset: offset - 1 })
  }, [data, partId, range, grain, runId, offset, utils])

  const compact = variant === 'section'
  const setWindow = (value: PositionWindow) => {
    setRange(value)
    setGrainOverride(null)
    setOffset(0)
  }
  const period = data?.days.length
    ? `${formatMonth(data.days[0]!.day)} – ${formatMonth((data.projection.at(-1) ?? data.days.at(-1))!.day)}`
    : null
  const grainLabel = POSITION_GRAINS.find((g) => g.value === grain)?.label
  const windowLabel = POSITION_WINDOWS.find((w) => w.value === range)?.label

  // Section is the `@container`: a narrow drawer folds grain and window into one dropdown.
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
      <div className='hidden items-center gap-2 @3xl:flex'>
        <RadioTab
          size='sm'
          value={grain}
          onValueChange={(v) => setGrainOverride(v as PositionGrain)}>
          {POSITION_GRAINS.map((g) => (
            <RadioTabItem
              key={g.value}
              value={g.value}
              size='sm'
              disabled={!grainAllowed(g.value, range)}>
              {g.label}
            </RadioTabItem>
          ))}
        </RadioTab>
        <RadioTab size='sm' value={range} onValueChange={(v) => setWindow(v as PositionWindow)}>
          {POSITION_WINDOWS.map((w) => (
            <RadioTabItem key={w.value} value={w.value} size='sm'>
              {w.label}
            </RadioTabItem>
          ))}
        </RadioTab>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='xs' className='@3xl:hidden'>
            {grainLabel} · {windowLabel}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {period && (
            <DropdownMenuLabel className='font-normal text-muted-foreground tabular-nums'>
              {period}
            </DropdownMenuLabel>
          )}
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={grain}
            onValueChange={(v) => setGrainOverride(v as PositionGrain)}>
            {POSITION_GRAINS.map((g) => (
              <DropdownMenuRadioItem
                key={g.value}
                value={g.value}
                disabled={!grainAllowed(g.value, range)}>
                {g.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Window</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={range}
            onValueChange={(v) => setWindow(v as PositionWindow)}>
            {POSITION_WINDOWS.map((w) => (
              <DropdownMenuRadioItem key={w.value} value={w.value}>
                {w.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <Section title='Position' className={cn('@container', SECTION_BLEED)} actions={controls}>
      {isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : error ? (
        <EmptySection
          className='mx-3'
          title='Could not load the position'
          description={error.message}
        />
      ) : !data || data.days.length === 0 ? (
        <EmptySection className='mx-3' title='No movements yet' />
      ) : (
        <PositionPlot key={partId} data={data} compact={compact} />
      )}
    </Section>
  )
}

// Memoised so a grain/window click doesn't redraw the old data before the new query lands.
const PositionPlot = memo(function PositionPlot({
  data,
  compact,
}: {
  data: PartSeriesData
  compact: boolean
}) {
  const isMobile = useIsMobile()
  const showBars = !isMobile
  const hatchId = `hatch-${useId().replace(/:/g, '')}`
  const rows = useMemo(() => buildPositionRows(data), [data])
  const prevRows = usePreviousDistinct(rows)

  // The scales tween, not the marks: every layer reads the eased domains, so a page
  // step scrolls the plot and a window change zooms it, ticks and bars included.
  const target = useMemo(() => {
    const x = xExtent(rows)
    const { left, right } = yExtents(rows, data.zones?.topOfGreen ?? null)
    return [...x, ...left, ...right]
  }, [rows, data.zones])
  const tween = useTween(target, TWEEN_MS)
  // Also true on the frame new data lands, before the tween's first tick, so old rows don't flash out.
  const moving = tween.progress < 1 || tween.to.join(',') !== target.join(',')
  const [xLo, xHi, lLo, lHi, rLo, rHi] = tween.current as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  // Old rows stay mounted while the old window scrolls out of view.
  const drawn = useMemo(
    () => (moving && prevRows ? mergeRows(prevRows, rows) : rows),
    [moving, prevRows, rows]
  )
  const maxXTicks = compact ? 5 : 10
  const xAxis = tickSets(tween, 0, (lo, hi) => xTicks(lo, hi, maxXTicks))
  const leftAxis = tickSets(tween, 2, (lo, hi) => niceTicks(lo, hi))
  const rightAxis = tickSets(tween, 4, (lo, hi) => niceTicks(lo, hi))

  const stockouts = useMemo(() => stockoutRuns(drawn), [drawn])
  const spans = useMemo(() => usageSpans(drawn), [drawn])
  const first = rows[0]?.day
  const last = rows[rows.length - 1]?.day
  const inRange = (day: string) => !!first && !!last && day >= first && day <= last
  const events = data.events.filter((e) => inRange(e.day))
  const projectedOn = new Map(rows.map((r) => [r.day, r.projected ?? r.onHand ?? 0]))
  const today = new Date().toLocaleDateString('en-CA')
  const zones = data.zones
  const zoneBands = zones
    ? [
        { ...ZONES[0], y1: 0, y2: zones.topOfRed },
        { ...ZONES[1], y1: zones.topOfRed, y2: zones.topOfYellow },
        { ...ZONES[2], y1: zones.topOfYellow, y2: zones.topOfGreen },
      ]
    : []

  // Array, not a fragment: recharts only scans direct children (see line-chart-widget.tsx).
  const layers = [
    <defs key='defs'>
      <pattern
        id={hatchId}
        patternUnits='userSpaceOnUse'
        width={4}
        height={4}
        patternTransform='rotate(45)'>
        <rect width={4} height={4} fill='var(--gray-4)' />
        <line x1={0} y1={0} x2={0} y2={4} stroke='var(--gray-7)' strokeWidth={1.5} />
      </pattern>
    </defs>,
    <CartesianGrid key='grid' vertical={false} />,
    <XAxis
      key='x'
      dataKey='t'
      type='number'
      domain={[xLo, xHi]}
      allowDataOverflow
      ticks={xAxis.ticks}
      interval={0}
      tickLine={false}
      axisLine={false}
      tickMargin={6}
      tick={(props) => (
        <FadeTick {...props} opacity={xAxis.opacity} format={(t) => formatDay(tToDay(t))} />
      )}
    />,
    <YAxis
      key='left'
      yAxisId='left'
      domain={[lLo, lHi]}
      allowDataOverflow
      ticks={leftAxis.ticks}
      tickLine={false}
      axisLine={false}
      width={compact ? 0 : 40}
      mirror={compact}
      tick={(props) => <FadeTick {...props} opacity={leftAxis.opacity} format={formatQty} />}
    />,
    showBars ? (
      <YAxis
        key='right'
        yAxisId='right'
        orientation='right'
        domain={[rLo, rHi]}
        allowDataOverflow
        ticks={rightAxis.ticks}
        tickLine={false}
        axisLine={false}
        width={compact ? 0 : 36}
        mirror={compact}
        tick={(props) => <FadeTick {...props} opacity={rightAxis.opacity} format={formatQty} />}
      />
    ) : null,
    ...zoneBands.map((z) => (
      <ReferenceArea
        key={`zone-${z.key}`}
        yAxisId='left'
        y1={z.y1}
        y2={z.y2}
        fill={z.color}
        fillOpacity={0.07}
        strokeOpacity={0}
        ifOverflow='hidden'
        label={{ value: z.label, position: 'insideRight', fill: MUTED_TEXT, fontSize: 10 }}
      />
    )),
    showBars ? (
      <Customized key='usage' component={<UsageBars spans={spans} hatchId={hatchId} />} />
    ) : null,
    // Invisible, so the tooltip lists usage.
    showBars ? (
      <Line
        key='used'
        yAxisId='right'
        dataKey='used'
        stroke='var(--color-used)'
        strokeWidth={0}
        dot={false}
        activeDot={false}
        isAnimationActive={false}
      />
    ) : null,
    showBars ? (
      <Line
        key='projectedUse'
        yAxisId='right'
        dataKey='projectedUse'
        stroke='var(--color-projectedUse)'
        strokeWidth={0}
        dot={false}
        activeDot={false}
        isAnimationActive={false}
      />
    ) : null,
    <Area
      key='bandLow'
      yAxisId='left'
      dataKey='bandLow'
      stackId='band'
      type='monotone'
      stroke='none'
      fill='transparent'
      tooltipType='none'
      activeDot={false}
      isAnimationActive={false}
    />,
    <Area
      key='bandSpan'
      yAxisId='left'
      dataKey='bandSpan'
      stackId='band'
      type='monotone'
      stroke='none'
      fill={LINE}
      fillOpacity={0.1}
      tooltipType='none'
      activeDot={false}
      isAnimationActive={false}
    />,
    <Line
      key='onHand'
      yAxisId='left'
      dataKey='onHand'
      type='linear'
      stroke='var(--color-onHand)'
      strokeWidth={2}
      dot={false}
      isAnimationActive={false}
    />,
    <Line
      key='projected'
      yAxisId='left'
      dataKey='projected'
      type='linear'
      stroke='var(--color-projected)'
      strokeWidth={2}
      strokeDasharray='5 4'
      dot={false}
      isAnimationActive={false}
    />,
    <Customized key='stockouts' component={<StockoutStrip runs={stockouts} />} />,
    <ReferenceLine
      key='today'
      yAxisId='left'
      x={dayToT(data.runAsOf)}
      stroke='var(--gray-10)'
      label={{
        value: data.runAsOf === today ? 'Today' : `Run ${formatDay(data.runAsOf)}`,
        position: 'insideTopLeft',
        fill: MUTED_TEXT,
        fontSize: 10,
      }}
    />,
    ...events.map((e, i) =>
      e.kind === 'order_by' ? (
        <ReferenceLine
          key={`ev-${i}`}
          yAxisId='left'
          x={dayToT(e.day)}
          stroke='var(--gray-10)'
          strokeDasharray='2 3'
          label={{ value: e.label, position: 'insideTopRight', fill: MUTED_TEXT, fontSize: 10 }}
        />
      ) : (
        <ReferenceDot
          key={`ev-${i}`}
          yAxisId='left'
          x={dayToT(e.day)}
          y={e.kind === 'stockout' ? 0 : (projectedOn.get(e.day) ?? 0)}
          r={4}
          fill={e.kind === 'stockout' ? 'var(--gray-12)' : LINE}
          stroke='var(--background)'
          strokeWidth={2}
        />
      )
    ),
    <ChartTooltip
      key='tooltip'
      active={moving ? false : undefined}
      content={
        <ChartTooltipContent
          indicator='line'
          valueFormatter={(v) => formatQty(Number(v))}
          labelFormatter={(_, payload) => <TooltipLabel row={payload?.[0]?.payload} />}
        />
      }
    />,
  ]

  return (
    <div className={cn('flex flex-col gap-2', !compact && 'px-3')}>
      <ChartContainer config={chartConfig} className='aspect-auto h-64 w-full'>
        <ComposedChart
          data={drawn}
          margin={
            compact
              ? { top: 4, right: 0, left: 0, bottom: 0 }
              : { top: 8, right: 0, left: 0, bottom: 0 }
          }>
          {layers}
        </ComposedChart>
      </ChartContainer>
      <PositionLegend data={data} showBars={showBars} hatchId={hatchId} compact={compact} />
    </div>
  )
})

/** One rect per usage span with a 2px surface gap after it; `Customized` passes the axis maps. */
function UsageBars({
  spans,
  hatchId,
  xAxisMap,
  yAxisMap,
  offset,
}: {
  spans: UsageSpan[]
  hatchId: string
  xAxisMap?: Record<string, ChartAxis>
  yAxisMap?: Record<string, ChartAxis>
  offset?: PlotOffset
}) {
  const x = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  const y = yAxisMap?.right
  if (!x || !y || !offset) return null
  const base = y.scale(0)
  const plotLeft = offset.left
  const plotRight = offset.left + offset.width
  return (
    <g>
      {spans.map((s) => {
        // A day's bar is centred on its point: half a day either side.
        const from = x.scale(dayToT(s.from) - 0.5)
        const to = x.scale(dayToT(s.to) + 0.5)
        const span = to - from
        const left = Math.max(plotLeft, from)
        const right = Math.min(plotRight, from + Math.max(0.5, span - Math.min(2, span / 3)))
        if (right <= left) return null
        const top = Math.max(offset.top, y.scale(s.value))
        return (
          <rect
            key={s.from}
            x={left}
            y={top}
            width={right - left}
            height={Math.max(0, base - top)}
            fill={s.projected ? `url(#${hatchId})` : USED}
            // Projected bars sit over the zones, so they stay see-through.
            fillOpacity={s.projected ? 0.5 : 0.55}
          />
        )
      })}
    </g>
  )
}

/** Stockout runs as a thin strip on the plot's bottom edge, a timeline marker rather than a wash. */
function StockoutStrip({
  runs,
  xAxisMap,
  offset,
}: {
  runs: { from: string; to: string }[]
  xAxisMap?: Record<string, ChartAxis>
  offset?: PlotOffset
}) {
  const x = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  if (!x || !offset) return null
  const y = offset.top + offset.height - STOCKOUT_STRIP / 2
  const plotLeft = offset.left
  const plotRight = offset.left + offset.width
  return (
    <g stroke={STOCKOUT} strokeOpacity={0.5} strokeWidth={STOCKOUT_STRIP}>
      {runs.map((r) => {
        const x1 = Math.max(plotLeft, x.scale(dayToT(r.from) - 0.5))
        const x2 = Math.min(plotRight, x.scale(dayToT(r.to) + 0.5))
        return x2 > x1 ? <line key={r.from} x1={x1} x2={x2} y1={y} y2={y} /> : null
      })}
    </g>
  )
}

function TooltipLabel({ row }: { row?: PositionRow }) {
  if (!row) return null
  return (
    <div className='flex flex-col gap-0.5'>
      <span>{formatDay(row.day)}</span>
      {row.stockout && <span className='font-normal text-muted-foreground'>Stockout day</span>}
      {row.events.map((e, i) => (
        <span key={`${i}-${e.kind}`} className='font-normal text-muted-foreground'>
          {e.label}
          {e.qty ? ` · ${formatQty(e.qty)}` : ''}
        </span>
      ))}
    </div>
  )
}

function PositionLegend({
  data,
  showBars,
  hatchId,
  compact,
}: {
  data: PartSeriesData
  showBars: boolean
  hatchId: string
  compact: boolean
}) {
  const hasProjection = data.projection.length > 0
  const flat = hasProjection && !data.seasonal
  const items: (PaginatedLegendItem | false)[] = [
    showBars && {
      key: 'used',
      node: (
        <LegendKey label='Used'>
          <span className='size-2.5 rounded-[2px]' style={{ background: USED, opacity: 0.55 }} />
        </LegendKey>
      ),
    },
    showBars &&
      hasProjection && {
        key: 'projectedUse',
        node: (
          <LegendKey label='Projected use'>
            <svg className='size-2.5' aria-hidden='true'>
              <rect width='100%' height='100%' fill={`url(#${hatchId})`} />
            </svg>
          </LegendKey>
        ),
      },
    {
      key: 'onHand',
      node: (
        <LegendKey label='On hand'>
          <span className='h-0.5 w-3 rounded-full' style={{ background: LINE }} />
        </LegendKey>
      ),
    },
    hasProjection && {
      key: 'projected',
      node: (
        <LegendKey label='Projected'>
          <span className='w-3 border-t-2 border-dashed' style={{ borderColor: LINE }} />
        </LegendKey>
      ),
    },
    data.days.some((d) => d.stockout) && {
      key: 'stockout',
      node: (
        <LegendKey label='Stockout'>
          <span className='w-3 border-t-[3px]' style={{ borderColor: STOCKOUT, opacity: 0.5 }} />
        </LegendKey>
      ),
    },
    flat && {
      key: 'flat',
      node: (
        <span>
          Projection flat: {data.historyMonths} {data.historyMonths === 1 ? 'month' : 'months'} of
          history
        </span>
      ),
    },
  ]
  const visible = items.filter((i): i is PaginatedLegendItem => i !== false)
  return <PaginatedLegend items={visible} align='start' className={cn(compact && 'px-3')} />
}

function LegendKey({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className='flex items-center gap-1.5'>
      {children}
      {label}
    </span>
  )
}
