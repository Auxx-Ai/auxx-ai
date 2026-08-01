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
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import { axisWidthFor, numericTickLabels } from '../../lib/axis-width'
import type { ChartRow, SeriesDef } from '../../lib/chart-transform'
import { seriesExtent, toChartConfig } from '../../lib/chart-transform'
import { PaginatedChartLegend } from './paginated-chart-legend'

export function BarChartWidget({
  config,
  rows,
  series,
  formatValue,
  formatAxisValue,
}: {
  config: BarChartConfig
  rows: ChartRow[]
  series: SeriesDef[]
  /** Full-precision format (tooltip) per the metric field's type/options. */
  formatValue?: (value: number) => string
  /** Compact format for axis ticks / data labels (`$12K`); falls back to `formatValue`. */
  formatAxisValue?: (value: number) => string
}) {
  const chartConfig = toChartConfig(series, config.color)
  const isHorizontal = config.layout === 'horizontal'
  const stacked = Boolean(config.secondaryGroupBy && config.stacked)
  const showLegend = config.showLegend !== false && series.length > 1
  const axisFormat = formatAxisValue ?? formatValue
  const tickFormatter = axisFormat ? (v: number) => axisFormat(v) : undefined
  const valueFormatter = formatValue ? (v: number | string) => formatValue(Number(v)) : undefined

  // Size the Y axis to its actual tick strings instead of recharts' fixed
  // default — long ticks (`$12,000.00`) silently clip otherwise.
  const { min, max } = seriesExtent(
    rows,
    series.map((s) => s.id),
    stacked
  )
  const yAxisWidth = isHorizontal
    ? axisWidthFor(rows.map((r) => String(r.label)))
    : axisWidthFor(numericTickLabels(min, max, axisFormat ?? String))

  return (
    <ChartContainer config={chartConfig} className='h-full w-full'>
      <BarChart
        data={rows}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={isHorizontal} horizontal={!isHorizontal} />
        {/* No fragments here: recharts scans direct children for axes, and
            fragments aren't flattened under React 19 — axes would be dropped. */}
        <XAxis
          type={isHorizontal ? 'number' : 'category'}
          dataKey={isHorizontal ? undefined : 'label'}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={isHorizontal ? tickFormatter : undefined}
        />
        <YAxis
          type={isHorizontal ? 'category' : 'number'}
          dataKey={isHorizontal ? 'label' : undefined}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          // Always a number: an `undefined`-valued width key would clobber
          // recharts' defaultProps in its {...defaultProps, ...props} merge → NaN layout.
          width={yAxisWidth}
          tickFormatter={isHorizontal ? undefined : tickFormatter}
        />

        <ChartTooltip content={<ChartTooltipContent valueFormatter={valueFormatter} />} />
        {showLegend && <ChartLegend content={<PaginatedChartLegend />} />}
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
                formatter={axisFormat ? (v: unknown) => axisFormat(Number(v)) : undefined}
                className='fill-muted-foreground text-[10px]'
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}
