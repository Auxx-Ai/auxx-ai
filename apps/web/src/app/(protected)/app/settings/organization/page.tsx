// apps/web/src/app/(protected)/app/settings/organization/page.tsx
import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { ProfileMemberships } from '~/components/organization'

export default function OrganizationPage() {
  return (
    <SettingsPage
      title="Organization"
      description="Manage organizations you belong to and pending invitations">
      <div className="">
        <ProfileMemberships />
      </div>
    </SettingsPage>
  )
}
