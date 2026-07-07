// apps/web/src/app/(protected)/app/settings/webhooks/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Lock } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { WebhookEndpointsSection } from '~/components/webhooks/ui/webhook-endpoints-section'
import { WebhooksSection } from '~/components/webhooks/ui/webhooks-section'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export default function WebhooksPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
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
      description='Send Auxx events to external services when something happens.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Webhooks' }]}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <WebhooksSection />
        <WebhookEndpointsSection />
      </div>
    </SettingsPage>
  )
}
