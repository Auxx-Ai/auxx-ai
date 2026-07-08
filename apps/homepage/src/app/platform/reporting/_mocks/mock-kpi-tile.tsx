// apps/homepage/src/app/platform/reporting/_mocks/mock-kpi-tile.tsx
'use client'

import NumberFlow from '@number-flow/react'
import { useInView } from 'motion/react'
import { useId, useRef } from 'react'
import { Area, AreaChart } from 'recharts'
import { ChartContainer } from '~/components/ui/chart'
import { cn } from '~/lib/utils'

interface MockKpiTileProps {
  label: string
  value: number
  /** e.g. '▲ 18%' — rendered in emerald when positive, amber when negative */
  deltaLabel?: string
  deltaTone?: 'positive' | 'negative'
  suffix?: string
  fractionDigits?: number
  spark?: { x: string; y: number }[]
  className?: string
}

/**
 * Animated KPI counter (counts up when scrolled into view) with an optional
 * trend sparkline. NumberFlow respects prefers-reduced-motion on its own.
 */
export function MockKpiTile({
  label,
  value,
  deltaLabel,
  deltaTone = 'positive',
  suffix,
  fractionDigits = 0,
  spark,
  className,
}: MockKpiTileProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const gradientId = useId().replace(/:/g, '')

  return (
    <div ref={ref} className={className}>
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='mt-1 flex items-baseline gap-2'>
        <NumberFlow
          value={inView ? value : 0}
          format={{ maximumFractionDigits: fractionDigits }}
          suffix={suffix}
          className='text-foreground text-3xl font-semibold tracking-tight'
        />
        {deltaLabel && (
          <span
            className={cn(
              'text-xs font-medium',
              deltaTone === 'positive'
                ? 'text-emerald-600 dark:text-emerald-500'
                : 'text-amber-600 dark:text-amber-500'
            )}>
            {deltaLabel}
          </span>
        )}
      </div>
      {spark && (
        <ChartContainer
          config={{ y: { label, color: 'var(--report-c1)' } }}
          className='mt-3 aspect-auto h-10 w-full'>
          <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
                <stop offset='0%' stopColor='var(--color-y)' stopOpacity={0.4} />
                <stop offset='100%' stopColor='var(--color-y)' stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area
              dataKey='y'
              type='monotone'
              stroke='var(--color-y)'
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
