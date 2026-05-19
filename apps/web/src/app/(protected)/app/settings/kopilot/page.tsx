// apps/web/src/app/(protected)/app/settings/kopilot/page.tsx
'use client'

import SettingsPage from '~/components/global/settings-page'
import { ModelSection } from './_components/model-section'
import { ToolsetsSection } from './_components/toolsets-section'

export default function KopilotSettingsPage() {
  return (
    <SettingsPage
      title='Kopilot'
      description='Configure the org-wide Kopilot defaults.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Kopilot' }]}>
      <div className='space-y-4 sm:space-y-10 p-3 sm:p-6'>
        <ModelSection />
        <ToolsetsSection />
      </div>
    </SettingsPage>
  )
}
