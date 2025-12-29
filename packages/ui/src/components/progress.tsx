'use client'

import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'

import { cn } from '@auxx/ui/lib/utils'

interface ProgressProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string
}

function Progress({ className, value, indicatorClassName = '', ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-foreground/20', className)}
      {...props}>
      <ProgressPrimitive.Indicator
        className={cn('h-full w-full flex-1 bg-foreground transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

interface CircularProgressProps {
  max?: number
  min?: number
  value: number
  gaugePrimary: string
  gaugeSecondary: string
  className?: string
  size?: number
}

export function CircularProgress({
  max = 100,
  min = 0,
  value = 0,
  size = 100,
  gaugePrimary,
  gaugeSecondary,
  className,
}: CircularProgressProps) {
  const circumference = 2 * Math.PI * 45
  const percentPx = circumference / 100
  const currentPercent = Math.round(((value - min) / (max - min)) * 100)

  return (
    <div
      className={cn('relative', className)}
      style={
        {
          '--circle-size': `100px`,
          '--circumference': circumference,
          '--percent-to-px': `${percentPx}px`,
          '--gap-percent': '5',
          '--offset-factor': '0',
          '--transition-length': '1s',
          '--transition-step': '200ms',
          '--delay': '0s',
          '--percent-to-deg': '3.6deg',
          transform: 'translateZ(0)',
        } as React.CSSProperties
      }>
      <svg fill="none" className="size-full" strokeWidth="2" viewBox="0 0 100 100">
        {currentPercent <= 90 && currentPercent >= 0 && (
          <circle
            cx="50"
            cy="50"
            r="45"
            strokeWidth="10"
            strokeDashoffset="0"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('opacity-100', gaugeSecondary)}
            style={
              {
                stroke: 'currentcolor',
                '--stroke-percent': 90 - currentPercent,
                '--offset-factor-secondary': 'calc(1 - var(--offset-factor))',
                strokeDasharray:
                  'calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)',
                transform:
                  'rotate(calc(1turn - 90deg - (var(--gap-percent) * var(--percent-to-deg) * var(--offset-factor-secondary)))) scaleY(-1)',
                transition: 'all var(--transition-length) ease var(--delay)',
                transformOrigin: 'calc(var(--circle-size) / 2) calc(var(--circle-size) / 2)',
              } as React.CSSProperties
            }
          />
        )}
        <circle
          cx="50"
          cy="50"
          r="45"
          strokeWidth="10"
          strokeDashoffset="0"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('opacity-100', gaugePrimary)}
          style={
            {
              stroke: 'currentcolor',
              '--stroke-percent': currentPercent,
              strokeDasharray:
                'calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference)',
              transition:
                'var(--transition-length) ease var(--delay),stroke var(--transition-length) ease var(--delay)',
              transitionProperty: 'stroke-dasharray,transform',
              transform:
                'rotate(calc(-90deg + var(--gap-percent) * var(--offset-factor) * var(--percent-to-deg)))',
              transformOrigin: 'calc(var(--circle-size) / 2) calc(var(--circle-size) / 2)',
            } as React.CSSProperties
          }
        />
      </svg>
      <span
        data-current-value={currentPercent}
        className="duration-[var(--transition-length)] delay-[var(--delay)] absolute inset-0 m-auto size-fit ease-linear animate-in fade-in">
        {currentPercent}
      </span>
    </div>
  )
}
