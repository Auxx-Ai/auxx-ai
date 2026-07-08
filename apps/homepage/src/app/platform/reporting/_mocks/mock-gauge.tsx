// apps/homepage/src/app/platform/reporting/_mocks/mock-gauge.tsx
'use client'

import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts'
import { ChartContainer } from '~/components/ui/chart'
import { cn } from '~/lib/utils'

interface MockGaugeProps {
  /** 0–100 */
  value: number
  valueLabel?: string
  label?: string
  colorVar?: string
  className?: string
}

/** Radial gauge with a center stat, e.g. "AI-resolved rate 58%". */
export function MockGauge({
  value,
  valueLabel,
  label,
  colorVar = 'report-c4',
  className,
}: MockGaugeProps) {
  const config = { value: { label: label ?? 'Rate', color: `var(--${colorVar})` } }
  const data = [{ name: label ?? 'Rate', value }]

  return (
    <div className={cn('relative', className)}>
      <ChartContainer config={config} className='aspect-auto h-36 w-full'>
        <RadialBarChart
          data={data}
          startAngle={220}
          endAngle={-40}
          innerRadius={56}
          outerRadius={76}>
          <PolarAngleAxis type='number' domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey='value'
            background
            cornerRadius={4}
            fill='var(--color-value)'
            angleAxisId={0}
          />
        </RadialBarChart>
      </ChartContainer>
      <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
        <div className='text-foreground text-2xl font-semibold tracking-tight'>
          {valueLabel ?? `${value}%`}
        </div>
        {label && <div className='text-muted-foreground text-xs'>{label}</div>}
      </div>
    </div>
  )
}
