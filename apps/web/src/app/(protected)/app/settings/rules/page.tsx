// apps/web/src/app/(protected)/app/settings/rules/page.tsx
'use client'

import SettingsPage from '~/components/global/settings-page'
import { InventorySourcesSection } from '~/components/inventory-bridge/ui/inventory-sources-section'
import { RecordRulesSection } from '~/components/record-rules/ui/record-rules-section'
import { useUser } from '~/hooks/use-user'

export default function RulesPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  return (
    <SettingsPage
      title='Rules'
      description='Automate reactions to record changes — conditions and actions on any field.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Rules' }]}>
      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        <RecordRulesSection />
        <InventorySourcesSection />
      </div>
    </SettingsPage>
  )
}
