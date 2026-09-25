// apps/web/src/components/mrp/ui/charts/position-chart.tsx
'use client'

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { EmptySection, SECTION_BLEED, Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { type ReactNode, useId, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsMobile } from '~/hooks/use-mobile'
import { api } from '~/trpc/react'
import {
  buildPositionRows,
  defaultGrain,
  formatDay,
  formatQty,
  type PartSeriesData,
  POSITION_GRAINS,
  POSITION_WINDOWS,
  type PositionGrain,
  type PositionRow,
  type PositionWindow,
  stockoutRuns,
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
  const grain = grainOverride ?? defaultGrain(range)

  const { data, isLoading, error } = api.mrp.partSeries.useQuery(
    { partId, window: range, grain, runId },
    { placeholderData: keepPreviousData }
  )

  const compact = variant === 'section'
  const controls = (
    <div className={cn('flex items-center gap-2', compact && 'flex-col items-end gap-1')}>
      <RadioTab size='sm' value={grain} onValueChange={(v) => setGrainOverride(v as PositionGrain)}>
        {POSITION_GRAINS.map((g) => (
          <RadioTabItem key={g.value} value={g.value} size='sm'>
            {g.label}
          </RadioTabItem>
        ))}
      </RadioTab>
      <RadioTab
        size='sm'
        value={range}
        onValueChange={(v) => {
          setRange(v as PositionWindow)
          setGrainOverride(null)
        }}>
        {POSITION_WINDOWS.map((w) => (
          <RadioTabItem key={w.value} value={w.value} size='sm'>
            {w.label}
          </RadioTabItem>
        ))}
      </RadioTab>
    </div>
  )

  return (
    <Section title='Position' className={SECTION_BLEED} actions={controls}>
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
        <PositionPlot data={data} compact={compact} />
      )}
    </Section>
  )
}

function PositionPlot({ data, compact }: { data: PartSeriesData; compact: boolean }) {
  const isMobile = useIsMobile()
  const showBars = !isMobile
  const hatchId = `hatch-${useId().replace(/:/g, '')}`
  const rows = useMemo(() => buildPositionRows(data), [data])
  const stockouts = useMemo(() => stockoutRuns(rows), [rows])
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
      dataKey='day'
      tickLine={false}
      axisLine={false}
      tickMargin={6}
      minTickGap={32}
      tickFormatter={formatDay}
    />,
    <YAxis
      key='left'
      yAxisId='left'
      tickLine={false}
      axisLine={false}
      width={compact ? 0 : 40}
      mirror={compact}
      tickFormatter={formatQty}
      allowDecimals={false}
    />,
    showBars ? (
      <YAxis
        key='right'
        yAxisId='right'
        orientation='right'
        tickLine={false}
        axisLine={false}
        width={compact ? 0 : 36}
        mirror={compact}
        tickFormatter={formatQty}
        allowDecimals={false}
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
        ifOverflow='extendDomain'
        label={{ value: z.label, position: 'insideRight', fill: MUTED_TEXT, fontSize: 10 }}
      />
    )),
    ...stockouts.map((s) => (
      <ReferenceArea
        key={`out-${s.from}`}
        yAxisId='left'
        x1={s.from}
        x2={s.to}
        fill='var(--gray-9)'
        fillOpacity={0.12}
        strokeOpacity={0}
      />
    )),
    showBars ? (
      <Bar
        key='used'
        yAxisId='right'
        dataKey='used'
        stackId='usage'
        fill='var(--color-used)'
        fillOpacity={0.55}
        isAnimationActive={false}
        shape={<BucketBar />}
      />
    ) : null,
    showBars ? (
      <Bar
        key='projectedUse'
        yAxisId='right'
        dataKey='projectedUse'
        stackId='usage'
        fill={`url(#${hatchId})`}
        isAnimationActive={false}
        shape={<BucketBar />}
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
    <ReferenceLine
      key='today'
      yAxisId='left'
      x={data.runAsOf}
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
          x={e.day}
          stroke='var(--gray-10)'
          strokeDasharray='2 3'
          label={{ value: e.label, position: 'insideTopRight', fill: MUTED_TEXT, fontSize: 10 }}
        />
      ) : (
        <ReferenceDot
          key={`ev-${i}`}
          yAxisId='left'
          x={e.day}
          y={e.kind === 'stockout' ? 0 : (projectedOn.get(e.day) ?? 0)}
          r={4}
          fill={e.kind === 'stockout' ? 'var(--gray-12)' : LINE}
          stroke='var(--background)'
          strokeWidth={2}
          ifOverflow='extendDomain'
        />
      )
    ),
    <ChartTooltip
      key='tooltip'
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
          data={rows}
          barCategoryGap={0}
          barGap={0}
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
}

/** A bucket's bar over its days, with a 2px surface gap after the bucket's last day. */
function BucketBar(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  fillOpacity?: number
  payload?: PositionRow
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill, fillOpacity, payload } = props
  if (height <= 0 || width <= 0) return null
  const gap = payload?.bucketEnd ? Math.min(2, width / 3) : 0
  // Overdraw by half a pixel so adjacent days of one bucket read as one bar.
  const w = Math.max(0.5, width - gap + (gap ? 0 : 0.5))
  return <rect x={x} y={y} width={w} height={height} fill={fill} fillOpacity={fillOpacity} />
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
  const flat = data.projection.length > 0 && !data.seasonal
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground',
        compact && 'px-3'
      )}>
      {showBars && (
        <LegendKey label='Used'>
          <span className='size-2.5 rounded-[2px]' style={{ background: USED, opacity: 0.55 }} />
        </LegendKey>
      )}
      {showBars && data.projection.length > 0 && (
        <LegendKey label='Projected use'>
          <svg className='size-2.5' aria-hidden='true'>
            <rect width='100%' height='100%' fill={`url(#${hatchId})`} />
          </svg>
        </LegendKey>
      )}
      <LegendKey label='On hand'>
        <span className='h-0.5 w-3 rounded-full' style={{ background: LINE }} />
      </LegendKey>
      {data.projection.length > 0 && (
        <LegendKey label='Projected'>
          <span className='w-3 border-t-2 border-dashed' style={{ borderColor: LINE }} />
        </LegendKey>
      )}
      {data.days.some((d) => d.stockout) && (
        <LegendKey label='Stockout'>
          <span
            className='size-2.5 rounded-[2px]'
            style={{ background: 'var(--gray-9)', opacity: 0.2 }}
          />
        </LegendKey>
      )}
      {flat && (
        <span>
          Projection flat: {data.historyMonths} {data.historyMonths === 1 ? 'month' : 'months'} of
          history
        </span>
      )}
    </div>
  )
}

function LegendKey({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className='flex items-center gap-1.5'>
      {children}
      {label}
    </span>
  )
}
