import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { AppearanceSettingsForm } from './_components/appearance-settings-form'

import { api } from '~/trpc/server'

type Props = {}

async function AdminAppearancePage({}: Props) {
  // const aiModels = []

  return (
    <SettingsPage
      title="Organization Appearance"
      description="Set the appearance of your organization"
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'AI Models' }]}>
      <div className="p-8">
        <AppearanceSettingsForm organizationId="" />
      </div>
    </SettingsPage>
  )
}

export default AdminAppearancePage
