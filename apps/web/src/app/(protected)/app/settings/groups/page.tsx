import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { Folder } from 'lucide-react'
import { GroupsOverview } from './_components/groups-overview'

type Props = {}

async function GroupsPage({}: Props) {
  return (
    <SettingsPage
      icon={<Folder />}
      title="Member groups"
      description="View and edit your workgroup members"
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Groups' }]}>
      <div className="p-6">
        <GroupsOverview />
      </div>
    </SettingsPage>
  )
}

export default GroupsPage
