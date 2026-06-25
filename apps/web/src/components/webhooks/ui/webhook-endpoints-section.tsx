// apps/web/src/components/webhooks/ui/webhook-endpoints-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Inbox, Plus } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useWebhookEndpoint, type WebhookEndpointRow } from '../hooks/use-webhook-endpoint'
import { WebhookEndpointCard } from './webhook-endpoint-card'
import { WebhookEndpointDialog } from './webhook-endpoint-dialog'
import { WebhookPlaceholderCard } from './webhook-placeholder-card'

/**
 * Incoming webhooks section: a card grid of inbound {@link WebhookEndpoint}s over
 * `api.webhookEndpoint`, with add/edit/delete wiring. Wraps the shared {@link SettingsSection},
 * mirroring `WebhooksSection` (outgoing). See plans/data-connectors/v6/webhooks-ui-plan.md §5.
 */
export function WebhookEndpointsSection() {
  const { data: endpoints, isLoading, destroy } = useWebhookEndpoint()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<WebhookEndpointRow | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const handleDelete = async (endpoint: WebhookEndpointRow) => {
    const ok = await confirm({
      title: 'Delete webhook endpoint?',
      description: `Remove "${endpoint.name}"? Deliveries to its URL will stop being accepted. This cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    destroy.mutate({ id: endpoint.id })
  }

  const addButton = (
    <Button variant='outline' size='sm' onClick={() => setCreateOpen(true)}>
      <Plus />
      Add
    </Button>
  )

  return (
    <SettingsSection
      icon={Inbox}
      title='Incoming'
      description='Receive events from any system — get a URL, paste it anywhere.'
      action={addButton}>
      {!isLoading && (
        <div className='@container'>
          <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
            {endpoints?.map((endpoint) => (
              <WebhookEndpointCard
                key={endpoint.id}
                endpoint={endpoint}
                onEdit={() => setEditing(endpoint)}
                onDelete={() => void handleDelete(endpoint)}
              />
            ))}
            {(!endpoints || endpoints.length === 0) && (
              <WebhookPlaceholderCard
                icon={<Inbox className='size-4 text-muted-foreground' />}
                title='Add an endpoint'
                subtitle='Incoming'
                description='Get a URL you can paste into any external system to receive events.'
                onClick={() => setCreateOpen(true)}
              />
            )}
          </div>
        </div>
      )}

      <WebhookEndpointDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing && (
        <WebhookEndpointDialog
          open={!!editing}
          endpoint={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog />
    </SettingsSection>
  )
}
