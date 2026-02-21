// apps/web/src/components/health/ui/status-dot.tsx
'use client'

import { HealthStatus } from '@auxx/lib/health/client'
import { cn } from '@auxx/ui/lib/utils'

interface StatusDotProps {
  status: HealthStatus | string
  showLabel?: boolean
}

/**
 * Green/red status indicator dot with optional label.
 */
export function StatusDot({ status, showLabel = false }: StatusDotProps) {
  const isOperational = status === HealthStatus.OPERATIONAL

  return (
    <div className='flex items-center gap-2'>
      <div
        className={cn('h-2.5 w-2.5 rounded-full', isOperational ? 'bg-green-500' : 'bg-red-500')}
      />
      {showLabel && (
        <span className={cn('text-sm', isOperational ? 'text-green-600' : 'text-red-600')}>
          {isOperational ? 'Operational' : 'Outage'}
        </span>
      )}
    </div>
  )
}
