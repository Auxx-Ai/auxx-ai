import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { auth } from '~/auth/server'
import { ProfileMemberships } from './_components/profile-membership'
import { headers } from 'next/headers'

type Props = {}

export default async function OrganizationPage({}: Props) {
  const session = await auth.api.getSession({ headers: await headers() })
  const defaultOrganizationId = session?.user?.defaultOrganizationId

  // const organizations = await api.organization.getMyOrganizations()

  return (
    <SettingsPage
      title="Organization"
      description="Manage organizations you belong to and pending invitations">
      <div className="">
        <ProfileMemberships
          // organizations={organizations}
          defaultOrganizationId={defaultOrganizationId}
        />
      </div>
    </SettingsPage>
  )
}
