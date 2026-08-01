// apps/web/src/components/mail/send-status-indicator.tsx
'use client'
import { SendStatus } from '@auxx/database/enums'
import type { SendStatus as SendStatusType } from '@auxx/database/types'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { RotateCw } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { sendStatusConfig } from './mail-status-config'

interface SendStatusIndicatorProps extends VariantProps<typeof recordBadgeVariants> {
  status?: SendStatusType | null
  error?: string | null
  attempts?: number
  className?: string
  onRetry?: () => void
}
/**
 * Displays the send status of a message as a RecordBadge-style chip with an
 * optional retry button. Reuses `recordBadgeVariants` and the `record-display`
 * / `record-remove` data-slots so it matches `RecordBadge`/`TicketBadge` and
 * renders correctly in dark mode.
 */
export function SendStatusIndicator({
  status,
  error,
  attempts,
  className,
  size,
  onRetry,
}: SendStatusIndicatorProps) {
  // Don't show indicator for successfully sent messages
  if (!status || status === SendStatus.SENT) {
    return null
  }
  // Use centralized configuration
  const config = sendStatusConfig[status]
  if (!config) return null
  const Icon = config.icon
  const canRetry = status === SendStatus.FAILED && !!onRetry
  // Build tooltip content for additional details
  const tooltipContent =
    error || (attempts && attempts > 1) ? (
      <div className='max-w-xs'>
        <p className='font-medium'>{config.description}</p>
        {error && <p className='mt-1 text-xs text-muted-foreground'>{error}</p>}
        {attempts && attempts > 1 && (
          <p className='mt-1 text-xs text-muted-foreground'>Attempted {attempts} times</p>
        )}
      </div>
    ) : undefined
  return (
    <Tooltip
      contentComponent={tooltipContent}
      content={!tooltipContent ? config.description : undefined}>
      <div
        data-slot='record-badge'
        className={cn(recordBadgeVariants({ size }), config.badgeClass, className)}>
        <Icon
          className={cn(
            'shrink-0',
            size === 'sm' ? 'size-3' : 'size-3.5',
            config.animate && 'animate-spin'
          )}
        />
        <span data-slot='record-display' className='truncate'>
          {config.label}
        </span>
        {canRetry && (
          <button
            type='button'
            data-slot='record-remove'
            aria-label='Retry sending'
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRetry?.()
            }}>
            <RotateCw />
          </button>
        )}
      </div>
    </Tooltip>
  )
}
