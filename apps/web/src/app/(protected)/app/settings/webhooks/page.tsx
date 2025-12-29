// apps/web/src/app/(protected)/app/settings/webhooks/page.tsx
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { PlusCircle, PlusIcon, Webhook } from 'lucide-react'
import { WebhookList } from './_components/webhook-list'
import { DialogWebhook } from './_components/dialog-webhook'
import SettingsPage from '~/components/global/settings-page'
import { EmptyState } from '~/components/global/empty-state'

export default function WebhooksPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  return (
    <SettingsPage
      title="Webhooks"
      description="Manage webhooks to integrate with external services. Webhooks allow you to receive notifications when specific events occur in the application."
      button={
        <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon />
          Create
        </Button>
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
      <div className="h-full flex">
        <WebhookList
          empty={
            <EmptyState
              icon={Webhook}
              title="No webhooks found."
              description={<>Create your first webhook to get started.</>}
              button={
                <Button size="sm" variant="outline" onClick={() => setCreateDialogOpen(true)}>
                  <PlusCircle />
                  Create Webhook
                </Button>
              }
            />
          }
        />
      </div>

      <DialogWebhook
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={() => setCreateDialogOpen(false)}
      />
    </SettingsPage>
  )
}
