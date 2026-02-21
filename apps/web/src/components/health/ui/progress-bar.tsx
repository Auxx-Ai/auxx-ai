// apps/web/src/components/health/ui/progress-bar.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'

interface ProgressBarProps {
  value: number
  max: number
  label?: string
}

/**
 * Horizontal progress bar for utilization display.
 */
export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  const color = percent > 80 ? 'bg-red-500' : percent > 60 ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div>
      {label && (
        <div className='flex justify-between text-sm mb-1'>
          <span className='text-muted-foreground'>{label}</span>
          <span className='font-mono'>
            {value} / {max} ({percent}%)
          </span>
        </div>
      )}
      <div className='h-2 bg-muted rounded-full overflow-hidden'>
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
