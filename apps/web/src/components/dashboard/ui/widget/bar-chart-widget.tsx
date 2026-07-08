// apps/web/src/components/dashboard/ui/widget/bar-chart-widget.tsx
'use client'

// Presentational bar chart. Driven entirely by `BarChartConfig` + the
// transformed rows/series from `chart-transform`. recharts layout naming is
// INVERTED: `config.layout === 'horizontal'` (bars run left→right) maps to
// recharts `layout='vertical'`. Multi-series (`secondaryGroupBy`) share a
// `stackId` when `stacked`, else render grouped. `showDataLabels` adds a
// `LabelList`; `cumulative` running totals are already applied upstream.

import type { BarChartConfig } from '@auxx/lib/dashboards/client'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import type { ChartRow, SeriesDef } from '../../lib/chart-transform'
import { toChartConfig } from '../../lib/chart-transform'

export function BarChartWidget({
  config,
  rows,
  series,
  formatValue,
}: {
  config: BarChartConfig
  rows: ChartRow[]
  series: SeriesDef[]
  /** Formats the numeric axis ticks per the metric field's type/options. */
  formatValue?: (value: number) => string
}) {
  const chartConfig = toChartConfig(series, config.color)
  const isHorizontal = config.layout === 'horizontal'
  const stacked = Boolean(config.secondaryGroupBy) && config.stacked
  const showLegend = config.showLegend !== false && series.length > 1
  const tickFormatter = formatValue ? (v: number) => formatValue(v) : undefined
  const valueFormatter = formatValue ? (v: number | string) => formatValue(Number(v)) : undefined

  return (
    <ChartContainer config={chartConfig} className='h-full w-full'>
      <BarChart
        data={rows}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={isHorizontal} horizontal={!isHorizontal} />
        {isHorizontal ? (
          <>
            <XAxis
              type='number'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={tickFormatter}
            />
            <YAxis
              type='category'
              dataKey='label'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={110}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey='label'
              type='category'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              type='number'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={tickFormatter}
            />
          </>
        )}
        <ChartTooltip content={<ChartTooltipContent valueFormatter={valueFormatter} />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {series.map((def) => (
          <Bar
            key={def.id}
            dataKey={def.id}
            fill={`var(--color-${def.id})`}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? 0 : 4}
            maxBarSize={48}>
            {config.showDataLabels && (
              <LabelList
                dataKey={def.id}
                position={isHorizontal ? 'right' : 'top'}
                className='fill-muted-foreground text-[10px]'
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}
