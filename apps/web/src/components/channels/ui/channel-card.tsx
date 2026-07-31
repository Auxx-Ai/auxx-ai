// apps/web/src/components/channels/ui/channel-card.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import {
  ListCard,
  type ListCardBadgeChip,
  type ListCardMenuItem,
  type ListCardStatus,
  renderBadgeChips,
} from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { ExternalLink, Plug, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { InboxItem } from '~/components/threads/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useChannelReconnect } from '../hooks/use-channel-reconnect'
import type { Channel } from '../store/channel-store'
import { getChannelProviderName, getIntegrationProviderIcon } from './channel-icon'

const DETAIL_BASE = '/app/settings/channels'

/** Resolve the corner status dot (tone + tooltip) from the channel's auth/sync state. */
export function channelStatus(channel: Channel): ListCardStatus {
  if (channel.requiresReauth) return { tone: 'error', label: 'Reconnect required' }
  if (channel.lastAuthError || channel.syncStatus === 'FAILED') {
    return { tone: 'error', label: channel.lastAuthError || 'Sync error' }
  }
  if (channel.syncStatus === 'SYNCING') return { tone: 'info', label: 'Syncing…' }
  if (!channel.enabled) return { tone: 'muted', label: 'Disabled' }
  return { tone: 'good', label: 'Active' }
}

/**
 * One channel tile: provider icon, name + provider label & connected date, a status dot, and
 * inbox/Personal badge chips. The three-dot menu carries the table's row actions — open, sync,
 * enable/disable, reconnect (when reauth is needed), and disconnect. Body links to the detail route.
 */
export function ChannelCard({ channel, inboxes }: { channel: Channel; inboxes: InboxItem[] }) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const linkedInbox = channel.inboxId
    ? inboxes.find((inbox) => inbox.id === channel.inboxId)
    : undefined

  // Members manage their own personal channels; shared channels need
  // `channels.manage` (mirrors the server's requireChannelManageAccess). Keyed on
  // the capability, not the legacy ADMIN/OWNER role — the server gate is the
  // capability, so a profile-granted member would otherwise see every action
  // disabled on a page they are allowed to use.
  const { can } = useAccess()
  const { userId } = useUser()
  const canManage =
    can(PermissionKey.channelsManage) ||
    (!!linkedInbox?.isPersonal && linkedInbox.ownerUserId === userId)

  const isForwarding =
    channel.provider === 'email' &&
    (channel.metadata as { channelType?: string } | null)?.channelType === 'forwarding-address'

  const isSyncing = channel.syncStatus === 'SYNCING'

  const toggle = api.channel.toggle.useMutation({
    onSuccess: () => utils.channel.list.invalidate(),
    onError: (error) => toastError({ title: 'Error updating channel', description: error.message }),
  })

  // Refetch so the card picks up the SYNCING status dot — this also covers the
  // `alreadyInProgress` reply, where a background poll is already running and no
  // new job was started.
  const syncMessages = api.channel.syncMessages.useMutation({
    onSuccess: () => utils.channel.list.invalidate(),
    onError: (error) => toastError({ title: 'Error starting sync', description: error.message }),
  })

  const disconnect = api.channel.disconnect.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate()
      utils.thread.getCounts.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error disconnecting channel', description: error.message })
    },
  })

  const { reconnect, pending: reconnectPending, Dialogs: reconnectDialogs } = useChannelReconnect()

  const displayName =
    channel.name ||
    (channel.provider === 'chat' ? channel.widgetSettings?.title : channel.identifier) ||
    channel.identifier ||
    `Unnamed ${getChannelProviderName(channel.provider)}`

  const chips: ListCardBadgeChip[] = []
  if (linkedInbox && !linkedInbox.isPersonal) chips.push({ label: linkedInbox.name })
  if (linkedInbox?.isPersonal)
    chips.push({ label: 'P', description: 'Personal', variant: 'magenta' })

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect channel?',
      description: 'This will remove the channel and its data. This action cannot be undone.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) disconnect.mutate({ integrationId: channel.id })
  }

  const menuItems: ListCardMenuItem[] = [
    {
      label: 'Open',
      icon: <ExternalLink />,
      onClick: () => router.push(`${DETAIL_BASE}/${channel.id}`),
    },
    {
      label: isSyncing ? 'Syncing…' : 'Sync messages',
      icon: <RefreshCw />,
      disabled:
        !canManage ||
        channel.provider === 'chat' ||
        isForwarding ||
        isSyncing ||
        syncMessages.isPending,
      onClick: () => syncMessages.mutate({ integrationId: channel.id, days: 7 }),
    },
    {
      label: channel.enabled ? 'Disable' : 'Enable',
      icon: <Power />,
      disabled: !canManage,
      onClick: () => toggle.mutate({ integrationId: channel.id, enabled: !channel.enabled }),
    },
    ...(channel.requiresReauth
      ? [
          {
            label: 'Reconnect',
            icon: <Plug />,
            disabled: !canManage || reconnectPending,
            onClick: () => reconnect(channel.id),
          },
        ]
      : []),
    {
      label: 'Disconnect',
      icon: <Trash2 />,
      destructive: true,
      disabled: !canManage || isForwarding,
      onClick: handleDisconnect,
    },
  ]

  return (
    <>
      <ListCard
        icon={getIntegrationProviderIcon(channel.provider, 'size-4')}
        title={displayName}
        subtitle={
          <span>
            {getChannelProviderName(channel.provider)}
            {channel.updatedAt
              ? ` · Connected ${format(new Date(channel.updatedAt), 'MMM d, yyyy')}`
              : ''}
          </span>
        }
        status={channelStatus(channel)}
        headerEnd={renderBadgeChips(chips)}
        href={`${DETAIL_BASE}/${channel.id}`}
        menuItems={menuItems}
        descriptionLines={0}
      />
      <ConfirmDialog />
      {reconnectDialogs}
    </>
  )
}
