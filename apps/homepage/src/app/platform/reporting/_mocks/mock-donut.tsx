// apps/homepage/src/app/platform/reporting/_mocks/mock-donut.tsx
'use client'

import { Cell, Pie, PieChart } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '~/components/ui/chart'
import { cn } from '~/lib/utils'
import { MockLegend } from './mock-card'

const SLOT_VARS = ['report-c1', 'report-c2', 'report-c3', 'report-c4']

interface MockDonutProps {
  data: { key: string; name: string; value: number }[]
  /** Big number in the donut hole, e.g. '68%' */
  centerValue?: string
  centerLabel?: string
  className?: string
  showLegend?: boolean
  /** Override the per-slice slot vars (e.g. a neutral 'report-rest' remainder) */
  slotVars?: string[]
}

/** Theme-aware donut with a center stat and a dot legend. Slots assigned in fixed order. */
export function MockDonut({
  data,
  centerValue,
  centerLabel,
  className,
  showLegend = true,
  slotVars = SLOT_VARS,
}: MockDonutProps) {
  const config = Object.fromEntries(
    data.map((d, i) => [d.key, { label: d.name, color: `var(--${slotVars[i % slotVars.length]})` }])
  )

  return (
    <div className={className}>
      <div className='relative'>
        <ChartContainer config={config} className='aspect-auto h-40 w-full'>
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Pie
              data={data}
              dataKey='value'
              nameKey='name'
              innerRadius={52}
              outerRadius={72}
              paddingAngle={2}
              strokeWidth={0}>
              {data.map((d, i) => (
                <Cell key={d.key} fill={`var(--${slotVars[i % slotVars.length]})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {centerValue && (
          <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
            <div className='text-foreground text-2xl font-semibold tracking-tight'>
              {centerValue}
            </div>
            {centerLabel && <div className='text-muted-foreground text-xs'>{centerLabel}</div>}
          </div>
        )}
      </div>
      {showLegend && (
        <MockLegend
          className={cn('justify-center')}
          items={data.map((d, i) => ({ label: d.name, colorVar: slotVars[i % slotVars.length] }))}
        />
      )}
    </div>
  )
}
