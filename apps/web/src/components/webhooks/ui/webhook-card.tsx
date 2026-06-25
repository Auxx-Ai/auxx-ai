// apps/web/src/components/webhooks/ui/webhook-card.tsx
'use client'

import type { WebhookEntity as Webhook } from '@auxx/database/types'
import { formatDistanceToNow } from 'date-fns'
import { Pencil, Send, Trash, Webhook as WebhookIcon } from 'lucide-react'
import { AppListCard, type AppListCardMenuItem } from '~/components/apps/ui/app-list-card'

interface WebhookCardProps {
  webhook: Webhook
  /** Open the edit dialog (also fires on card-body click). */
  onEdit: () => void
  /** Fire a test delivery at the destination URL. */
  onTest: () => void
  /** Delete the webhook (confirmed by the caller). */
  onDelete: () => void
  /** Disables the Test menu item while a test is in flight. */
  testing?: boolean
}

/** The destination host shown as the card subtitle — falls back to the raw URL if unparseable. */
function urlHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** "3 event types · Last triggered 2 hours ago" — summary line under the title. */
function describeWebhook(webhook: Webhook): string {
  const events =
    webhook.eventTypes && webhook.eventTypes.length > 0
      ? `${webhook.eventTypes.length} event type${webhook.eventTypes.length === 1 ? '' : 's'}`
      : 'All events'
  const triggered = webhook.lastTriggeredAt
    ? `Last triggered ${formatDistanceToNow(webhook.lastTriggeredAt, { addSuffix: true })}`
    : 'Never triggered'
  return `${events} · ${triggered}`
}

/**
 * One outgoing webhook rendered with the shared {@link AppListCard} (the apps/connections card).
 * The three-dot menu carries Edit / Test / Delete; clicking the card body opens Edit.
 * Mirrors {@link ConnectionCard}. See plans/data-connectors/v6/webhooks-ui-plan.md §4.
 */
export function WebhookCard({ webhook, onEdit, onTest, onDelete, testing }: WebhookCardProps) {
  const menuItems: AppListCardMenuItem[] = [
    { label: 'Edit', icon: <Pencil />, onClick: onEdit },
    { label: 'Test', icon: <Send />, onClick: onTest, disabled: testing },
    { label: 'Delete', icon: <Trash />, onClick: onDelete, destructive: true },
  ]

  return (
    <AppListCard
      title={webhook.name}
      subtitle={urlHost(webhook.url)}
      description={describeWebhook(webhook)}
      icon={<WebhookIcon className='size-4' />}
      badges={webhook.isActive ? undefined : [{ label: 'Inactive' }]}
      onClick={onEdit}
      menuItems={menuItems}
    />
  )
}
