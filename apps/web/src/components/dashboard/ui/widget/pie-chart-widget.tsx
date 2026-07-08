// apps/web/src/components/dashboard/ui/widget/pie-chart-widget.tsx
'use client'

// Presentational pie/donut chart. `config.donut` adds an inner radius;
// `showCenterTotal` overlays the summed total in the donut hole via a recharts
// `Label`. Slice colors cycle `--chart-N` (honoring `config.color` for the
// single-hue case) through `toPieRows`.

import type { PieChartConfig } from '@auxx/lib/dashboards/client'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@auxx/ui/components/chart'
import { Cell, Label, Pie, PieChart } from 'recharts'
import type { ChartAggregateResult } from '../../lib/chart-transform'
import { toPieRows } from '../../lib/chart-transform'

export function PieChartWidget({
  config,
  result,
  formatValue,
}: {
  config: PieChartConfig
  result: ChartAggregateResult
  /** Formats the center total per the metric field's type/options. */
  formatValue?: (value: number) => string
}) {
  const rows = toPieRows(result, config.color)
  const showLegend = config.showLegend !== false
  const valueFormatter = formatValue ? (v: number | string) => formatValue(Number(v)) : undefined
  // Label lookup keyed by group label so the tooltip/legend read display names.
  const chartConfig: ChartConfig = Object.fromEntries(
    rows.map((r) => [r.label, { label: r.label, color: r.fill }])
  )

  return (
    <ChartContainer config={chartConfig} className='h-full w-full'>
      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <ChartTooltip
          content={
            <ChartTooltipContent nameKey='label' hideLabel valueFormatter={valueFormatter} />
          }
        />
        <Pie
          data={rows}
          dataKey='value'
          nameKey='label'
          innerRadius={config.donut ? '55%' : 0}
          outerRadius='80%'
          strokeWidth={1}
          label={
            config.showDataLabels
              ? ({ payload, percent }) => `${payload.label} (${((percent ?? 0) * 100).toFixed(0)}%)`
              : undefined
          }
          labelLine={false}>
          {rows.map((row) => (
            <Cell key={row.label} fill={row.fill} />
          ))}
          {config.donut && config.showCenterTotal && (
            <Label
              position='center'
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox)) return null
                const { cx, cy } = viewBox as { cx: number; cy: number }
                return (
                  <text x={cx} y={cy} textAnchor='middle' dominantBaseline='central'>
                    <tspan
                      x={cx}
                      y={cy}
                      className='fill-foreground font-semibold text-lg tabular-nums'>
                      {formatValue
                        ? formatValue(result.totalValue)
                        : result.totalValue.toLocaleString()}
                    </tspan>
                    <tspan x={cx} y={(cy ?? 0) + 18} className='fill-muted-foreground text-xs'>
                      Total
                    </tspan>
                  </text>
                )
              }}
            />
          )}
        </Pie>
        {showLegend && <ChartLegend content={<ChartLegendContent nameKey='label' />} />}
      </PieChart>
    </ChartContainer>
  )
}
