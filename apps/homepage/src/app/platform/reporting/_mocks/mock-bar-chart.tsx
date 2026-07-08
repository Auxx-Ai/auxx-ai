// apps/homepage/src/app/platform/reporting/_mocks/mock-bar-chart.tsx
'use client'

import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '~/components/ui/chart'
import { cn } from '~/lib/utils'

interface MockBarChartProps {
  data: { name: string; value: number }[]
  /** chart slot var, e.g. 'report-c1' */
  colorVar?: string
  /** horizontal = bars run left→right with category labels on the y-axis */
  horizontal?: boolean
  label?: string
  className?: string
  showTooltip?: boolean
}

/** Theme-aware bar chart with rounded data-ends and a per-bar hover tooltip. */
export function MockBarChart({
  data,
  colorVar = 'report-c1',
  horizontal = false,
  label = 'Tickets',
  className,
  showTooltip = true,
}: MockBarChartProps) {
  const config = { value: { label, color: `var(--${colorVar})` } }

  return (
    <ChartContainer config={config} className={cn('aspect-auto h-40 w-full', className)}>
      {horizontal ? (
        <BarChart
          data={data}
          layout='vertical'
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          barSize={14}>
          <XAxis type='number' hide />
          <YAxis
            type='category'
            dataKey='name'
            tickLine={false}
            axisLine={false}
            width={64}
            fontSize={11}
          />
          {showTooltip && <ChartTooltip cursor={false} content={<ChartTooltipContent />} />}
          <Bar dataKey='value' fill='var(--color-value)' radius={[0, 4, 4, 0]} />
        </BarChart>
      ) : (
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={32}>
          <XAxis dataKey='name' tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
          {showTooltip && <ChartTooltip cursor={false} content={<ChartTooltipContent />} />}
          <Bar dataKey='value' fill='var(--color-value)' radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ChartContainer>
  )
}
