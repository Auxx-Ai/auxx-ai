// apps/web/src/app/(protected)/app/settings/webhooks/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Lock, PlusCircle, PlusIcon, Webhook } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { DialogWebhook } from './_components/dialog-webhook'
import { WebhookList } from './_components/webhook-list'

export default function WebhooksPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.webhooks)) {
    return (
      <SettingsPage
        title='Webhooks'
        description='Manage webhooks to integrate with external services.'
        breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
        <EmptyState
          icon={Lock}
          title='Webhooks Not Available'
          description='Upgrade your plan to use webhooks.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Webhooks'
      description='Manage webhooks to integrate with external services. Webhooks allow you to receive notifications when specific events occur in the application.'
      button={
        <Button variant='outline' size='sm' onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon />
          Create
        </Button>
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
      <WebhookList
        empty={
          <EmptyState
            icon={Webhook}
            title='No webhooks found.'
            description={<>Create your first webhook to get started.</>}
            button={
              <Button size='sm' variant='outline' onClick={() => setCreateDialogOpen(true)}>
                <PlusCircle />
                Create Webhook
              </Button>
            }
          />
        }
      />

      <DialogWebhook
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={() => setCreateDialogOpen(false)}
      />
    </SettingsPage>
  )
}
