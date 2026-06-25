// apps/web/src/components/webhooks/ui/webhooks-section.tsx
'use client'

import type { WebhookEntity as Webhook } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { Plus, Webhook as WebhookIcon } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useWebhook } from '../hooks/use-webhook'
import { WebhookCard } from './webhook-card'
import { DialogWebhook } from './webhook-dialog'
import { WebhookPlaceholderCard } from './webhook-placeholder-card'

/**
 * Outgoing webhooks section: the card grid + add/edit/test/delete wiring over `api.webhook`.
 * Wraps the shared {@link SettingsSection} for its header chrome, mirroring `ConnectionsSection`.
 * See plans/data-connectors/v6/webhooks-ui-plan.md §4.
 */
export function WebhooksSection() {
  const { data: webhooks, isLoading, destroy, testWebhook } = useWebhook()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const handleDelete = async (webhook: Webhook) => {
    const ok = await confirm({
      title: 'Delete webhook?',
      description: `Remove "${webhook.name}"? This action cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    destroy.mutate({ id: webhook.id })
  }

  const addButton = (
    <Button variant='outline' size='sm' onClick={() => setCreateOpen(true)}>
      <Plus />
      Add
    </Button>
  )

  return (
    <SettingsSection
      icon={WebhookIcon}
      title='Outgoing'
      description='Send Auxx events to an external URL when something happens.'
      action={addButton}>
      {!isLoading && (
        <div className='@container'>
          <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
            {webhooks?.map((webhook) => (
              <WebhookCard
                key={webhook.id}
                webhook={webhook}
                onEdit={() => setEditing(webhook)}
                onTest={() => testWebhook.mutate({ url: webhook.url })}
                onDelete={() => void handleDelete(webhook)}
                testing={testWebhook.isPending}
              />
            ))}
            {(!webhooks || webhooks.length === 0) && (
              <WebhookPlaceholderCard
                icon={<WebhookIcon className='size-4 text-muted-foreground' />}
                title='Add a webhook'
                subtitle='Outgoing'
                description='Send Auxx events to an external URL when something happens.'
                onClick={() => setCreateOpen(true)}
              />
            )}
          </div>
        </div>
      )}

      <DialogWebhook
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => setCreateOpen(false)}
      />
      {editing && (
        <DialogWebhook
          open={!!editing}
          webhook={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => setEditing(null)}
        />
      )}

      <ConfirmDialog />
    </SettingsSection>
  )
}
