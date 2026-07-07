// apps/web/src/components/inbox/ui/connect-existing-channel-dialog.tsx
'use client'

import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { useChannels } from '~/components/channels/hooks/use-channels'
import type { Channel } from '~/components/channels/store/channel-store'
import {
  getChannelProviderName,
  getIntegrationProviderIcon,
} from '~/components/channels/ui/channel-icon'
import { useInboxes } from '~/components/threads/hooks/use-inbox'

/** Display name for a channel row (name → identifier → provider label). */
function channelLabel(channel: Channel): string {
  return channel.name || channel.identifier || getChannelProviderName(channel.provider)
}

/**
 * Searchable picker of channels that can be connected to this inbox — every
 * channel not already on it (personal-inbox channels included), example channels
 * excluded. Dumb component: picking a row fires `onSelect(channel)` and closes;
 * the page owns the reassign + move-conversations flow.
 */
export function ConnectExistingChannelDialog({
  open,
  onOpenChange,
  inboxId,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inboxId: string
  onSelect: (channel: Channel) => void
}) {
  const channels = useChannels().filter((c) => c.inboxId !== inboxId && !c.isExample)
  const { inboxes } = useInboxes()

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Connect existing channel'
      description='Pick a channel to route into this inbox.'>
      <CommandInput placeholder='Search channels…' />
      <CommandList>
        <CommandEmpty>No other channels to connect.</CommandEmpty>
        {channels.map((channel) => {
          const currentInbox = channel.inboxId
            ? inboxes.find((i) => i.id === channel.inboxId)
            : undefined
          const subtitle = !channel.inboxId
            ? 'Not connected'
            : currentInbox?.isPersonal
              ? `personal inbox — “${currentInbox.name}”`
              : currentInbox
                ? `currently in “${currentInbox.name}”`
                : 'currently in another inbox'
          return (
            <CommandItem
              key={channel.id}
              value={`${channelLabel(channel)} ${channel.identifier ?? ''} ${channel.id}`}
              onSelect={() => onSelect(channel)}>
              {getIntegrationProviderIcon(channel.provider, 'size-4')}
              <div className='flex flex-col'>
                <span className='text-sm'>{channelLabel(channel)}</span>
                <span className='text-muted-foreground text-xs'>{subtitle}</span>
              </div>
            </CommandItem>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
