// apps/web/src/components/mail/send-status-indicator.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { RefreshCw } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'
import { sendStatusConfig } from './mail-status-config'
import { SendStatus } from '@auxx/database/enums'
interface SendStatusIndicatorProps {
  status?: SendStatus | null
  error?: string | null
  attempts?: number
  className?: string
  onRetry?: () => void
}
/**
 * Component to display the send status of a message with optional retry functionality
 * Uses the centralized mail status configuration for consistent styling
 */
export function SendStatusIndicator({
  status,
  error,
  attempts,
  className,
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
  // Build tooltip content for additional details
  const tooltipContent =
    error || (attempts && attempts > 1) ? (
      <div className="max-w-xs">
        <p className="font-medium">{config.description}</p>
        {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
        {attempts && attempts > 1 && (
          <p className="mt-1 text-xs text-muted-foreground">Attempted {attempts} times</p>
        )}
      </div>
    ) : undefined
  // Full mode display with status badge and optional retry button
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Tooltip
        contentComponent={tooltipContent}
        content={!tooltipContent ? config.description : undefined}>
        <div
          className={cn(
            'inline-flex items-center ps-2 h-6 rounded-md text-xs',
            config.bgColor,
            config.borderColor,
            'border',
            !(status === SendStatus.FAILED && onRetry) && 'pe-2'
          )}>
          <Icon className={cn('h-3 w-3', config.animate && 'animate-spin')} />
          {status === SendStatus.FAILED && onRetry && (
            <Button
              size="xs"
              variant="ghost"
              className="rounded-l-none py-0 hover:bg-black/10"
              onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </Tooltip>
    </div>
  )
}
