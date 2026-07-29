// apps/web/src/components/inbox/ui/inbox-channel-card.tsx
'use client'

import type { InboxIntegration } from '@auxx/lib/inboxes'
import {
  ListCard,
  type ListCardMenuItem,
  type ListCardStatus,
  renderBadgeChips,
} from '@auxx/ui/components/list-card'
import { ExternalLink, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useChannelById } from '~/components/channels/store/channel-store'
import { channelStatus } from '~/components/channels/ui/channel-card'
import {
  getChannelProviderName,
  getIntegrationProviderIcon,
} from '~/components/channels/ui/channel-icon'

const DETAIL_BASE = '/app/settings/channels'

/** Static fallback dot for an integration not (yet) present in the channel store. */
const CONNECTED_STATUS: ListCardStatus = { tone: 'good', label: 'Connected' }

/** Display name for an integration — its name, else the capitalized provider. */
function getIntegrationName(integration: { name: string; provider: string }): string {
  if (integration.name) return integration.name
  return integration.provider.charAt(0).toUpperCase() + integration.provider.slice(1)
}

interface InboxChannelCardProps {
  integration: InboxIntegration
  onRemove: (integration: InboxIntegration) => void
  removePending?: boolean
  /**
   * Whether the viewer may open the channel's own settings page — the client
   * mirror of `requireChannelManageAccess`, which carves out the owner of a
   * personal channel. NOT the same gate as {@link canRemove}.
   */
  canOpen: boolean
  /** Whether the viewer may unroute the channel from this inbox. */
  canRemove: boolean
}

/**
 * One connected-channel tile on the inbox detail page: provider icon, name +
 * provider/email subtitle, a live status dot (from the channel store, falling
 * back to "Connected"), and a "Default" chip. The three-dot menu opens the
 * channel detail or removes the channel from this inbox (unassign, not disconnect).
 *
 * The two affordances answer to two different server gates, so they take two
 * props: opening follows `requireChannelManageAccess` (`channels.manage` OR
 * personal-channel owner), while removal follows `inbox.removeIntegration`
 * (`channels.manage` AND inbox Manager, with no ownership carve-out).
 */
export function InboxChannelCard({
  integration,
  onRemove,
  removePending,
  canOpen,
  canRemove,
}: InboxChannelCardProps) {
  const router = useRouter()
  const { integrationId } = integration
  const { name, email, provider } = integration.integration

  // Live status if the channel is in the store; otherwise a plain "Connected" dot.
  const channel = useChannelById(integrationId)
  const status = channel ? channelStatus(channel) : CONNECTED_STATUS

  const providerName = getChannelProviderName(provider)

  const menuItems: ListCardMenuItem[] = []
  if (canOpen) {
    menuItems.push({
      label: 'Open',
      icon: <ExternalLink />,
      onClick: () => router.push(`${DETAIL_BASE}/${integrationId}`),
    })
  }
  if (canRemove) {
    menuItems.push({
      label: 'Remove from inbox',
      icon: <Trash2 />,
      destructive: true,
      disabled: removePending,
      onClick: () => onRemove(integration),
    })
  }

  return (
    <ListCard
      icon={getIntegrationProviderIcon(provider, 'size-4')}
      title={getIntegrationName({ name, provider })}
      subtitle={email ? `${providerName} · ${email}` : providerName}
      status={status}
      headerEnd={integration.isDefault ? renderBadgeChips([{ label: 'Default' }]) : undefined}
      href={canOpen ? `${DETAIL_BASE}/${integrationId}` : undefined}
      menuItems={menuItems.length > 0 ? menuItems : undefined}
      descriptionLines={0}
    />
  )
}
