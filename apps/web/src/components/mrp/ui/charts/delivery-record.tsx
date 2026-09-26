// apps/web/src/components/mrp/ui/charts/delivery-record.tsx
'use client'

import { MRP_EXCLUSION_LABELS, MRP_MIN_RECEIPTS } from '@auxx/lib/mrp/client'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { EmptySection } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { memo, type ReactNode, useId, useMemo } from 'react'
import {
  CartesianGrid,
  Customized,
  ReferenceLine,
  Scatter,
  ScatterChart,
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
} from '~/components/charts/tween-axis'
import { useIsMobile } from '~/hooks/use-mobile'
import { useTween } from '~/hooks/use-tween'
import type { RouterOutputs } from '~/trpc/react'
import {
  buildDeliveryRecord,
  type DeliveryPoint,
  type DeliveryRecord as DeliveryRecordData,
  deliveryExtents,
  formatLateness,
  ROLLING_MEDIAN_WINDOW,
} from './delivery-record-data'
import { formatDay, niceTicks, tToDay, xTicks } from './position-chart-data'

// Status palette, not categorical: the shape (filled / hollow) carries the state first.
const ON_TIME = 'var(--green-9)'
const LATE = 'var(--amber-9)'
const MEDIAN = 'var(--gray-11)'
const EXCLUDED = 'var(--gray-8)'
const MUTED_TEXT = 'var(--muted-foreground)'
const R = 4
const HIT_R = 12

const chartConfig = {
  lateness: { label: 'Lateness' },
  excluded: { label: 'Excluded' },
} satisfies ChartConfig

/** Days late per PO line by order date, with a rolling median (plan 16 §4). */
export function DeliveryRecord({
  performance,
  compact = false,
}: {
  performance: RouterOutputs['mrp']['supplierPerformance']
  compact?: boolean
}) {
  const record = useMemo(() => buildDeliveryRecord(performance), [performance])
  const points = record.clean.length + record.excluded.length
  if (points === 0 && record.noExpected === 0) {
    return <EmptySection orientation='horizontal' title='No receipts yet' />
  }
  const receipts = record.clean.length + record.noExpected
  const thin = receipts < MRP_MIN_RECEIPTS
  const medianLateness = performance.supplier.stats.medianLatenessDays
  const header = [
    `${receipts} receipt${receipts === 1 ? '' : 's'}`,
    medianLateness !== null ? `median ${formatLateness(medianLateness)}` : null,
    record.noExpected > 0 ? `${record.noExpected} without an expected date` : null,
  ].filter(Boolean)

  return (
    <div className='flex flex-col gap-2'>
      <div className='text-xs text-muted-foreground tabular-nums'>
        {header.join(' · ')}
        {thin && <span className='text-amber-600'> · not trusted yet</span>}
      </div>
      {points > 0 && <DeliveryPlot record={record} compact={compact} />}
    </div>
  )
}

const DeliveryPlot = memo(function DeliveryPlot({
  record,
  compact,
}: {
  record: DeliveryRecordData
  compact: boolean
}) {
  const isMobile = useIsMobile()
  const target = useMemo(() => deliveryExtents(record), [record])
  // A refetch eases the scales instead of jumping them; there is no window control in v1.
  const tween = useTween(target, TWEEN_MS)
  const moving = tween.progress < 1 || tween.to.join(',') !== target.join(',')
  const [xLo, xHi, yLo, yHi] = tween.current as [number, number, number, number]
  const maxXTicks = isMobile || compact ? 4 : 6
  const xAxis = tickSets(tween, 0, (lo, hi) => xTicks(lo, hi, maxXTicks))
  const yAxis = tickSets(tween, 2, (lo, hi) => niceTicks(lo, hi, isMobile ? 4 : 5))
  const lastMedian = record.median.at(-1)

  // Array, not a fragment: recharts only scans direct children.
  const layers = [
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
      key='y'
      dataKey='lateness'
      type='number'
      domain={[yLo, yHi]}
      allowDataOverflow
      ticks={yAxis.ticks}
      interval={0}
      tickLine={false}
      axisLine={false}
      width={compact ? 0 : 40}
      mirror={compact}
      tick={(props) => (
        <FadeTick
          {...props}
          opacity={yAxis.opacity}
          format={(v) => (v === 0 ? '0' : formatLateness(v))}
        />
      )}
    />,
    <ReferenceLine
      key='zero'
      y={0}
      stroke='var(--gray-10)'
      label={{ value: 'on time', position: 'insideBottomRight', fill: MUTED_TEXT, fontSize: 10 }}
    />,
    record.median.length > 1 ? (
      <Customized
        key='median'
        component={
          <MedianLine
            median={record.median}
            label={lastMedian ? `median ${formatLateness(lastMedian.value)}` : ''}
          />
        }
      />
    ) : null,
    <Scatter
      key='excluded'
      name='excluded'
      data={record.excluded}
      shape={ExcludedShape}
      isAnimationActive={false}
    />,
    <Scatter
      key='clean'
      name='lateness'
      data={record.clean}
      shape={CleanShape}
      isAnimationActive={false}
    />,
    <ChartTooltip
      key='tooltip'
      active={moving ? false : undefined}
      cursor={false}
      content={({ active, payload }) => {
        const point = payload?.[0]?.payload as DeliveryPoint | undefined
        const row = payload?.find((p) => p.dataKey === 'lateness')
        return (
          <ChartTooltipContent
            active={active}
            hideIndicator
            payload={
              point && row
                ? [
                    point.kind === 'excluded'
                      ? { ...row, name: 'excluded', value: 'not counted' }
                      : { ...row, name: 'lateness', value: formatLateness(point.lateness) },
                  ]
                : []
            }
            labelFormatter={() => <PointLabel point={point} />}
          />
        )
      }}
    />,
  ]

  return (
    <div className='flex flex-col gap-2'>
      <ChartContainer
        config={chartConfig}
        className={cn('aspect-auto w-full', compact ? 'h-40' : 'h-48')}>
        <ScatterChart margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>{layers}</ScatterChart>
      </ChartContainer>
      <DeliveryLegend record={record} />
    </div>
  )
})

/** A filled dot for on time, a hollow one for late, each on a 2px surface ring. */
function CleanShape(props: unknown) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: DeliveryPoint }
  const late = payload.kind === 'late'
  return (
    <g>
      <circle cx={cx} cy={cy} r={HIT_R} fill='transparent' />
      <circle cx={cx} cy={cy} r={R + 2} fill='var(--background)' />
      {late ? (
        <circle cx={cx} cy={cy} r={R - 0.75} fill='none' stroke={LATE} strokeWidth={1.5} />
      ) : (
        <circle cx={cx} cy={cy} r={R} fill={ON_TIME} />
      )}
    </g>
  )
}

function ExcludedShape(props: unknown) {
  const { cx, cy } = props as { cx: number; cy: number }
  return (
    <g>
      <circle cx={cx} cy={cy} r={HIT_R} fill='transparent' />
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill='var(--background)'
        stroke={EXCLUDED}
        strokeWidth={1.25}
        strokeDasharray='1.5 1.5'
      />
    </g>
  )
}

/** The rolling median as a dashed path with its last value labelled; `Customized` passes the axis maps. */
function MedianLine({
  median,
  label,
  xAxisMap,
  yAxisMap,
  offset,
}: {
  median: { t: number; value: number }[]
  label: string
  xAxisMap?: Record<string, ChartAxis>
  yAxisMap?: Record<string, ChartAxis>
  offset?: PlotOffset
}) {
  const clipId = `median-clip-${useId().replace(/:/g, '')}`
  const x = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  const y = yAxisMap ? Object.values(yAxisMap)[0] : undefined
  if (!x || !y || !offset) return null
  const d = median
    .map((m, i) => `${i === 0 ? 'M' : 'L'}${x.scale(m.t)},${y.scale(m.value)}`)
    .join(' ')
  const last = median[median.length - 1]
  if (!last) return null
  const plotRight = offset.left + offset.width
  return (
    <g pointerEvents='none'>
      <clipPath id={clipId}>
        <rect x={offset.left} y={offset.top} width={offset.width} height={offset.height} />
      </clipPath>
      <path
        d={d}
        clipPath={`url(#${clipId})`}
        fill='none'
        stroke={MEDIAN}
        strokeWidth={2}
        strokeDasharray='5 4'
        strokeLinejoin='round'
        strokeLinecap='round'
      />
      <text
        x={Math.min(plotRight, x.scale(last.t))}
        y={y.scale(last.value) - 8}
        textAnchor='end'
        fontSize={10}
        fill={MUTED_TEXT}>
        {label}
      </text>
    </g>
  )
}

function PointLabel({ point }: { point?: DeliveryPoint }) {
  if (!point) return null
  const exclusion = point.excludedReason ? MRP_EXCLUSION_LABELS[point.excludedReason] : null
  return (
    <div className='flex max-w-64 flex-col gap-0.5'>
      <span>{point.purchaseOrderName ?? 'Purchase order'}</span>
      <span className='truncate font-normal text-muted-foreground'>
        {point.partName ?? 'Unnamed part'}
        {point.partSku ? ` · ${point.partSku}` : ''}
      </span>
      <span className='font-normal text-muted-foreground tabular-nums'>
        ordered {formatDay(point.orderedAt)}
        {point.expectedAt ? ` · expected ${formatDay(point.expectedAt)}` : ''}
        {point.lastReceivedAt ? ` · received ${formatDay(point.lastReceivedAt)}` : ''}
      </span>
      {exclusion ? (
        <span className='font-normal whitespace-normal text-muted-foreground'>{exclusion.why}</span>
      ) : (
        <span className='font-normal text-muted-foreground tabular-nums'>
          lead time {point.leadTimeDays ?? '–'} d
          {point.fill !== null ? ` · fill ${Math.round(point.fill * 100)} %` : ''}
        </span>
      )}
    </div>
  )
}

function DeliveryLegend({ record }: { record: DeliveryRecordData }) {
  const items: (PaginatedLegendItem | false)[] = [
    record.clean.some((p) => p.kind === 'on_time') && {
      key: 'on_time',
      node: (
        <LegendKey label='On time'>
          <span className='size-2 rounded-full' style={{ background: ON_TIME }} />
        </LegendKey>
      ),
    },
    record.clean.some((p) => p.kind === 'late') && {
      key: 'late',
      node: (
        <LegendKey label='Late'>
          <span className='size-2 rounded-full border-[1.5px]' style={{ borderColor: LATE }} />
        </LegendKey>
      ),
    },
    record.median.length > 1 && {
      key: 'median',
      node: (
        <LegendKey label={`Rolling median (last ${ROLLING_MEDIAN_WINDOW})`}>
          <span className='w-3 border-t-2 border-dashed' style={{ borderColor: MEDIAN }} />
        </LegendKey>
      ),
    },
    record.excluded.length > 0 && {
      key: 'excluded',
      node: (
        <LegendKey label='Excluded'>
          <span
            className='size-2 rounded-full border border-dotted'
            style={{ borderColor: EXCLUDED }}
          />
        </LegendKey>
      ),
    },
  ]
  return (
    <PaginatedLegend
      items={items.filter((i): i is PaginatedLegendItem => i !== false)}
      align='start'
    />
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
