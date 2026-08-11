// apps/web/src/components/mail/send-status-indicator.tsx
'use client'
import { SendStatus } from '@auxx/database/enums'
import type { SendStatus as SendStatusType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { RotateCw } from 'lucide-react'
import type React from 'react'
import { useMemo } from 'react'
import { useChannelById } from '~/components/channels/store/channel-store'
import { getChannelProviderName } from '~/components/channels/ui/channel-icon'
import { Tooltip } from '~/components/global/tooltip'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { sendStatusConfig } from './mail-status-config'
import { extractIntegrationId, humanizeSendError } from './send-status-error'

// Only `size` is borrowed from the badge cva — `variant` below is this
// component's own (badge vs. icon), not `recordBadgeVariants`' default/link.
interface SendStatusIndicatorProps extends Pick<VariantProps<typeof recordBadgeVariants>, 'size'> {
  status?: SendStatusType | null
  error?: string | null
  attempts?: number
  className?: string
  onRetry?: () => void
  isRetrying?: boolean
  /**
   * `badge` renders the labelled chip used in message headers. `icon` renders a
   * bare glyph sized for the thread-list status-dot slot and the detail view's
   * icon-button row.
   */
  variant?: 'badge' | 'icon'
  /**
   * Channel the message was sent through. Used to name the channel in the error
   * copy when the provider error doesn't embed an id itself.
   */
  integrationId?: string | null
}

/**
 * Surfaces a non-`SENT` send status. Hovering explains what went wrong; clicking
 * opens a menu with the full error and a Retry action.
 *
 * Renders nothing for `SENT` (and for a missing status), so call sites can drop
 * it in unconditionally.
 */
export function SendStatusIndicator({
  status,
  error,
  attempts,
  className,
  size,
  onRetry,
  isRetrying,
  variant = 'badge',
  integrationId,
}: SendStatusIndicatorProps) {
  // Prefer the id the provider named in its own error — a message can be sent
  // through a channel other than the thread's current one.
  const channel = useChannelById(extractIntegrationId(error) ?? integrationId ?? undefined)
  const channelName = channel
    ? channel.name || channel.identifier || getChannelProviderName(channel.provider)
    : undefined
  const friendlyError = useMemo(() => humanizeSendError(error, channelName), [error, channelName])

  // Don't show indicator for successfully sent messages
  if (!status || status === SendStatus.SENT) {
    return null
  }
  // Use centralized configuration
  const config = sendStatusConfig[status]
  if (!config) return null
  const Icon = config.icon
  const canRetry = status === SendStatus.FAILED && !!onRetry

  const iconSizeClass = size === 'sm' ? 'size-3' : 'size-3.5'

  const visual =
    variant === 'icon' ? (
      // Fills the trigger so the call site sets one size (via `className`)
      // instead of keeping the button and the glyph in sync by hand.
      <Icon className={cn('size-full shrink-0', config.color, config.animate && 'animate-spin')} />
    ) : (
      <>
        <Icon className={cn('shrink-0', iconSizeClass, config.animate && 'animate-spin')} />
        <span data-slot='record-display' className='truncate'>
          {config.label}
        </span>
      </>
    )

  const triggerClassName =
    variant === 'icon'
      ? cn(
          'inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] focus-visible:outline-none',
          onRetry && 'cursor-pointer',
          className
        )
      : cn(recordBadgeVariants({ size }), config.badgeClass, onRetry && 'cursor-pointer', className)

  const tooltipContent = (
    <div className='max-w-xs'>
      <p className='font-medium'>{config.label}</p>
      <p className='mt-1 text-xs text-muted-foreground'>{friendlyError ?? config.description}</p>
      {canRetry && <p className='mt-1 text-xs text-muted-foreground'>Click to retry</p>}
    </div>
  )

  // Without a retry handler there's nothing to put in a menu — the tooltip
  // carries the whole story, so render a plain (non-interactive) indicator.
  if (!canRetry) {
    return (
      <Tooltip contentComponent={tooltipContent}>
        <div
          data-slot={variant === 'badge' ? 'record-badge' : undefined}
          className={triggerClassName}>
          {visual}
        </div>
      </Tooltip>
    )
  }

  // The indicator lives inside clickable thread rows and message headers, so
  // every pointer event it handles has to stop short of opening the thread.
  const swallow = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <DropdownMenu>
      {/* `allowInteraction` stops SimpleTooltip preventDefault-ing pointerdown,
          which would otherwise swallow the trigger's own open gesture. */}
      <Tooltip contentComponent={tooltipContent} allowInteraction>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            aria-label={config.label}
            data-slot={variant === 'badge' ? 'record-badge' : undefined}
            className={triggerClassName}
            onClick={swallow}
            onPointerDown={swallow}>
            {visual}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        // Anchored to the trigger's start so the list-row icon (far left) opens
        // rightward instead of over the sidebar; Radix flips it for the
        // detail-view icon row, which sits against the right edge.
        align='start'
        className='w-72 p-3'
        onClick={swallow}
        onPointerDown={swallow}>
        <p className='text-sm font-medium'>{config.label}</p>
        <p className='mt-1 text-xs text-muted-foreground'>{friendlyError ?? config.description}</p>
        {attempts !== undefined && attempts > 1 && (
          <p className='mt-1 text-xs text-muted-foreground'>Attempted {attempts} times</p>
        )}
        <Button
          variant='outline'
          size='sm'
          className='mt-3 w-full'
          loading={isRetrying}
          loadingText='Retrying...'
          onClick={(e) => {
            e.stopPropagation()
            onRetry?.()
          }}>
          <RotateCw />
          Retry sending
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
