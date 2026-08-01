// apps/web/src/components/dashboard/ui/widget/line-chart-widget.tsx
'use client'

// Presentational line/area chart. `config.area` switches Line→Area; multi-series
// comes from `secondaryGroupBy`. Dot-less `type='monotone'` lines per house
// style. Cumulative running totals are pre-applied by `chart-transform`.

import type { LineChartConfig } from '@auxx/lib/dashboards/client'
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { axisWidthFor, numericTickLabels } from '../../lib/axis-width'
import type { ChartRow, SeriesDef } from '../../lib/chart-transform'
import { seriesExtent, toChartConfig } from '../../lib/chart-transform'
import { PaginatedChartLegend } from './paginated-chart-legend'

export function LineChartWidget({
  config,
  rows,
  series,
  formatValue,
  formatAxisValue,
}: {
  config: LineChartConfig
  rows: ChartRow[]
  series: SeriesDef[]
  /** Full-precision format (tooltip) per the metric field's type/options. */
  formatValue?: (value: number) => string
  /** Compact format for axis ticks (`$12K`); falls back to `formatValue`. */
  formatAxisValue?: (value: number) => string
}) {
  const chartConfig = toChartConfig(series, config.color)
  const showLegend = config.showLegend !== false && series.length > 1
  const stacked = Boolean(config.secondaryGroupBy && config.stacked)
  const axisFormat = formatAxisValue ?? formatValue
  const tickFormatter = axisFormat ? (v: number) => axisFormat(v) : undefined
  const valueFormatter = formatValue ? (v: number | string) => formatValue(Number(v)) : undefined

  // Size the Y axis to its actual tick strings instead of recharts' fixed
  // default 60px — long ticks (`$12,000.00`) silently clip otherwise. Only
  // areas stack (plain lines ignore `stackId`), so the extent follows suit.
  const { min, max } = seriesExtent(
    rows,
    series.map((s) => s.id),
    Boolean(config.area) && stacked
  )
  const yAxisWidth = axisWidthFor(numericTickLabels(min, max, axisFormat ?? String))

  // Array, NOT a fragment: recharts finds axes/grid/tooltip/legend by scanning
  // direct children, and fragments aren't flattened under React 19 (react-is@18
  // doesn't recognize React 19 elements), so a fragment silently drops them all.
  const axes = [
    <CartesianGrid key='grid' vertical={false} />,
    <XAxis key='x' dataKey='label' tickLine={false} axisLine={false} tickMargin={8} />,
    <YAxis
      key='y'
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      width={yAxisWidth}
      tickFormatter={tickFormatter}
    />,
    <ChartTooltip
      key='tooltip'
      content={<ChartTooltipContent valueFormatter={valueFormatter} />}
    />,
    showLegend ? <ChartLegend key='legend' content={<PaginatedChartLegend />} /> : null,
  ]

  if (config.area) {
    return (
      <ChartContainer config={chartConfig} className='h-full w-full'>
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {axes}
          {series.map((def) => (
            <Area
              key={def.id}
              dataKey={def.id}
              type='monotone'
              stroke={`var(--color-${def.id})`}
              fill={`var(--color-${def.id})`}
              fillOpacity={0.2}
              strokeWidth={2}
              stackId={stacked ? 'stack' : undefined}
              dot={false}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={chartConfig} className='h-full w-full'>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {axes}
        {series.map((def) => (
          <Line
            key={def.id}
            dataKey={def.id}
            type='monotone'
            stroke={`var(--color-${def.id})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}
