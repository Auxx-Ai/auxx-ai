// apps/homepage/src/app/platform/reporting/_mocks/mock-line-chart.tsx
'use client'

import { useId } from 'react'
import { Area, AreaChart, XAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '~/components/ui/chart'
import { cn } from '~/lib/utils'

export interface MockSeries {
  key: string
  label: string
  /** chart slot var, e.g. 'report-c1' */
  colorVar: string
}

interface MockLineChartProps {
  data: Record<string, string | number>[]
  xKey: string
  series: MockSeries[]
  className?: string
  showXAxis?: boolean
  showTooltip?: boolean
}

/** Theme-aware area/line chart with gradient fills and a hover tooltip. */
export function MockLineChart({
  data,
  xKey,
  series,
  className,
  showXAxis = false,
  showTooltip = true,
}: MockLineChartProps) {
  const gradientPrefix = useId().replace(/:/g, '')
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: `var(--${s.colorVar})` }])
  ) satisfies ChartConfig

  return (
    <ChartContainer config={config} className={cn('aspect-auto h-40 w-full', className)}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`${gradientPrefix}-${s.key}`}
              x1='0'
              y1='0'
              x2='0'
              y2='1'>
              <stop offset='0%' stopColor={`var(--color-${s.key})`} stopOpacity={0.35} />
              <stop offset='100%' stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {showXAxis && (
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={6} fontSize={10} />
        )}
        {showTooltip && (
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator='line' />} />
        )}
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type='monotone'
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            fill={`url(#${gradientPrefix}-${s.key})`}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}
