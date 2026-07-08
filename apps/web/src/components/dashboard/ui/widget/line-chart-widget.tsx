// apps/web/src/components/dashboard/ui/widget/line-chart-widget.tsx
'use client'

// Presentational line/area chart. `config.area` switches Line→Area; multi-series
// comes from `secondaryGroupBy`. Dot-less `type='monotone'` lines per house
// style. Cumulative running totals are pre-applied by `chart-transform`.

import type { LineChartConfig } from '@auxx/lib/dashboards/client'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { ChartRow, SeriesDef } from '../../lib/chart-transform'
import { toChartConfig } from '../../lib/chart-transform'

export function LineChartWidget({
  config,
  rows,
  series,
  formatValue,
}: {
  config: LineChartConfig
  rows: ChartRow[]
  series: SeriesDef[]
  /** Formats the numeric axis ticks per the metric field's type/options. */
  formatValue?: (value: number) => string
}) {
  const chartConfig = toChartConfig(series, config.color)
  const showLegend = config.showLegend !== false && series.length > 1
  const stacked = Boolean(config.secondaryGroupBy) && config.stacked
  const tickFormatter = formatValue ? (v: number) => formatValue(v) : undefined
  const valueFormatter = formatValue ? (v: number | string) => formatValue(Number(v)) : undefined

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
      tickFormatter={tickFormatter}
    />,
    <ChartTooltip
      key='tooltip'
      content={<ChartTooltipContent valueFormatter={valueFormatter} />}
    />,
    showLegend ? <ChartLegend key='legend' content={<ChartLegendContent />} /> : null,
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
