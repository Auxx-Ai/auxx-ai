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
  /** Whether channel navigation and routing controls should be available. */
  canManage: boolean
}

/**
 * One connected-channel tile on the inbox detail page: provider icon, name +
 * provider/email subtitle, a live status dot (from the channel store, falling
 * back to "Connected"), and a "Default" chip. The three-dot menu opens the
 * channel detail or removes the channel from this inbox (unassign, not disconnect).
 */
export function InboxChannelCard({
  integration,
  onRemove,
  removePending,
  canManage,
}: InboxChannelCardProps) {
  const router = useRouter()
  const { integrationId } = integration
  const { name, email, provider } = integration.integration

  // Live status if the channel is in the store; otherwise a plain "Connected" dot.
  const channel = useChannelById(integrationId)
  const status = channel ? channelStatus(channel) : CONNECTED_STATUS

  const providerName = getChannelProviderName(provider)

  const menuItems: ListCardMenuItem[] | undefined = canManage
    ? [
        {
          label: 'Open',
          icon: <ExternalLink />,
          onClick: () => router.push(`${DETAIL_BASE}/${integrationId}`),
        },
        {
          label: 'Remove from inbox',
          icon: <Trash2 />,
          destructive: true,
          disabled: removePending,
          onClick: () => onRemove(integration),
        },
      ]
    : undefined

  return (
    <ListCard
      icon={getIntegrationProviderIcon(provider, 'size-4')}
      title={getIntegrationName({ name, provider })}
      subtitle={email ? `${providerName} · ${email}` : providerName}
      status={status}
      headerEnd={integration.isDefault ? renderBadgeChips([{ label: 'Default' }]) : undefined}
      href={canManage ? `${DETAIL_BASE}/${integrationId}` : undefined}
      menuItems={menuItems}
      descriptionLines={0}
    />
  )
}
