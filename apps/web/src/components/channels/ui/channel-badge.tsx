// apps/web/src/components/channels/ui/channel-badge.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { getIntegrationColor, getIntegrationIconClass } from '~/components/mail/mail-status-config'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { type Channel, useChannelStore } from '../store/channel-store'

interface ChannelBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Integration id, resolved via the channel store when `channel` is not given. */
  channelId?: string
  /** Pre-resolved channel row; skips the store lookup. */
  channel?: Channel
  className?: string
}

/**
 * Inline pill for a channel (an Integration row). Channels are not records,
 * so this composes `recordBadgeVariants` with the provider icon, the same
 * shape as `ToolsetBadge` uses for `toolset:` chips. Falls back to a neutral
 * label when the id no longer resolves (e.g. a disconnected channel still
 * referenced by stored config).
 */
export function ChannelBadge({ channelId, channel, className, variant, size }: ChannelBadgeProps) {
  const fromStore = useChannelStore((s) => (channelId ? s.channelMap.get(channelId) : undefined))
  const resolved = channel ?? fromStore
  const Icon = getIntegrationIconClass(resolved?.provider)
  const color = getIntegrationColor(resolved?.provider)

  return (
    <span
      data-slot='channel-badge'
      className={cn(recordBadgeVariants({ variant, size }), className)}>
      <span
        className='flex size-4 shrink-0 items-center justify-center rounded'
        style={{ backgroundColor: `${color}20` }}>
        <Icon className='size-3' style={{ color }} />
      </span>
      <span data-slot='record-display' className='truncate max-w-[160px]'>
        {resolved?.name || resolved?.email || 'Unknown channel'}
      </span>
    </span>
  )
}
