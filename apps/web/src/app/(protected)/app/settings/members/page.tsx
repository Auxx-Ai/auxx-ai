// apps/web/src/app/(protected)/app/settings/members/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Button } from '@auxx/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Folder, Plus, Users } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import SettingsPage from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { GroupsTab } from '~/components/groups'
import { MembersTab } from '~/components/members'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import InviteFormPopover from './_components/invite-popover'

/**
 * Combined Members + Groups settings page. One SettingsPage with a Members/Groups
 * tab strip in the sticky sub-header; the tab persists via the `?t=` query param.
 */
export default function MembersPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const [tab, setTab] = useQueryState('t', { defaultValue: 'members' })
  const [createGroupOpen, setCreateGroupOpen] = useState(false)

  const { hasAccess, getLimit } = useFeatureFlags()
  const { data: activeMemberCount = 0 } = api.member.activeCount.useQuery()

  const canUseTeam = hasAccess(FeatureKey.teammates)
  const teamLimit = getLimit(FeatureKey.teammates)
  const canInvite =
    canUseTeam &&
    (teamLimit === '+' || (typeof teamLimit === 'number' && teamLimit > activeMemberCount))

  const headerButton =
    tab === 'groups' ? (
      <Button size='sm' onClick={() => setCreateGroupOpen(true)}>
        <Plus />
        Create Group
      </Button>
    ) : canInvite ? (
      <InviteFormPopover>
        <Button size='sm'>
          <Plus />
          Invite Member
        </Button>
      </InviteFormPopover>
    ) : (
      <Tooltip content='You have reached the maximum number of members allowed for your plan.'>
        <Button size='sm' variant='outline' className='opacity-50'>
          <Plus />
          Invite Member
        </Button>
      </Tooltip>
    )

  return (
    <Tabs value={tab} onValueChange={setTab} className='flex h-full min-h-0 flex-1 flex-col'>
      <SettingsPage
        icon={<Users />}
        title='Members and Groups'
        description='Members and groups in your organization'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Members and Groups' },
        ]}
        button={headerButton}
        subHeaderClassName='p-0'
        subHeader={
          <TabsList variant='outline'>
            <TabsTrigger value='members' variant='outline'>
              <Users />
              Members
            </TabsTrigger>
            <TabsTrigger value='groups' variant='outline'>
              <Folder />
              Groups
            </TabsTrigger>
          </TabsList>
        }>
        <TabsContent value='members' className='flex flex-1 flex-col'>
          {!canInvite && (
            <div className='p-3 sm:p-6'>
              <UpgradeBanner />
            </div>
          )}
          <MembersTab />
        </TabsContent>
        <TabsContent value='groups' className='flex flex-1 flex-col'>
          <GroupsTab createOpen={createGroupOpen} onCreateOpenChange={setCreateGroupOpen} />
        </TabsContent>
      </SettingsPage>
    </Tabs>
  )
}
