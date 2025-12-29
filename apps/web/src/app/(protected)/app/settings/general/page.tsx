import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { EditOrganizationForm } from './_components/edit-organization'

type Props = {}

export default function GeneralPage({}: Props) {
  return (
    <SettingsPage title="General" description="Manage your organization and user preferences">
      <div className="p-8">
        <EditOrganizationForm />
      </div>
    </SettingsPage>
  )
}
