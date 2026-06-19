// apps/web/src/app/(protected)/app/settings/connections/page.tsx
'use client'

import { Plug } from 'lucide-react'
import { ConnectionsSection } from '~/components/connections/ui/connections-section'
import SettingsPage from '~/components/global/settings-page'

/**
 * Settings → Channels → Connections. The single home for OAuth accounts, API keys,
 * and database connections across apps, workflows, and data connectors.
 * See plans/connections/unify-connection-definition.md §15.
 */
export default function ConnectionsPage() {
  return (
    <SettingsPage
      icon={<Plug className='size-5' />}
      title='Connections'
      description='Connect and manage the accounts, API keys, and databases your workspace uses.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Connections' }]}>
      <div className='flex flex-col flex-1 p-3 sm:p-6'>
        <ConnectionsSection />
      </div>
    </SettingsPage>
  )
}
