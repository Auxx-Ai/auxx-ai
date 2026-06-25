// apps/web/src/components/webhooks/ui/webhook-endpoint-card.tsx
'use client'

import { useCopy } from '@auxx/ui/hooks/use-copy'
import { formatDistanceToNow } from 'date-fns'
import { Copy, Inbox, Pencil, Trash, TriangleAlert } from 'lucide-react'
import { AppListCard, type AppListCardMenuItem } from '~/components/apps/ui/app-list-card'
import type { WebhookEndpointRow } from '../hooks/use-webhook-endpoint'

interface WebhookEndpointCardProps {
  endpoint: WebhookEndpointRow
  /** Open the edit dialog (also fires on card-body click). */
  onEdit: () => void
  /** Delete the endpoint (confirmed by the caller). */
  onDelete: () => void
}

const VERIFICATION_LABEL: Record<WebhookEndpointRow['verification'], string> = {
  none: 'Open',
  token: 'Token',
  hmac: 'HMAC',
}

/** "HMAC · Last event 2 hours ago" — verification mode + liveness, under the title. */
function describeEndpoint(endpoint: WebhookEndpointRow): string {
  const mode = VERIFICATION_LABEL[endpoint.verification]
  const liveness = endpoint.lastEventAt
    ? `Last event ${formatDistanceToNow(endpoint.lastEventAt, { addSuffix: true })}`
    : 'No events yet'
  return `${mode} · ${liveness}`
}

/**
 * One inbound {@link WebhookEndpoint} rendered with the shared {@link AppListCard}.
 * Subtitle is the derived public URL; the three-dot menu carries Copy URL / Edit / Delete;
 * clicking the card body opens Edit. An unverified (`none`) endpoint shows an amber `Open`
 * badge. See plans/data-connectors/v6/webhooks-ui-plan.md §5.
 */
export function WebhookEndpointCard({ endpoint, onEdit, onDelete }: WebhookEndpointCardProps) {
  const { copy } = useCopy({ toastMessage: 'Webhook URL copied' })

  const menuItems: AppListCardMenuItem[] = [
    { label: 'Copy URL', icon: <Copy />, onClick: () => copy(endpoint.url) },
    { label: 'Edit', icon: <Pencil />, onClick: onEdit },
    { label: 'Delete', icon: <Trash />, onClick: onDelete, destructive: true },
  ]

  return (
    <AppListCard
      title={endpoint.name}
      description={describeEndpoint(endpoint)}
      icon={<Inbox className='size-4' />}
      badges={
        endpoint.verification === 'none'
          ? [{ label: 'Open', icon: <TriangleAlert className='size-3 text-amber-600' /> }]
          : undefined
      }
      onClick={onEdit}
      menuItems={menuItems}
    />
  )
}
