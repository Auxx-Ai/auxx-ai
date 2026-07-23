// apps/web/src/app/(protected)/app/settings/permissions/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Folder, ShieldCheck, User, Users } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import SettingsPage from '~/components/global/settings-page'
import { GranteeOverridesTab } from '~/components/permissions/ui/grantee-overrides-tab'
import { MemberBaselineTab } from '~/components/permissions/ui/member-baseline-tab'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Permissions settings — configures org-wide member access (v2 §1). Admin-only;
 * editing is gated by the `granularPermissions` plan feature (else the grid is
 * read-only under an upgrade banner). Three leveled surfaces: the member
 * baseline, group overrides, and per-member overrides, each writing sparse grant
 * rows through the grant service.
 */
export default function PermissionsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const [tab, setTab] = useQueryState('t', { defaultValue: 'baseline' })
  const { hasAccess } = useFeatureFlags()

  const canEdit = hasAccess(FeatureKey.granularPermissions)

  return (
    <Tabs value={tab} onValueChange={setTab} className='flex h-full min-h-0 flex-1 flex-col'>
      <SettingsPage
        icon={<ShieldCheck />}
        title='Permissions'
        description='Configure what members, groups, and individuals can access'
        breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Permissions' }]}
        subHeaderClassName='p-0'
        subHeader={
          <TabsList variant='outline'>
            <TabsTrigger value='baseline' variant='outline'>
              <Users />
              Member baseline
            </TabsTrigger>
            <TabsTrigger value='groups' variant='outline'>
              <Folder />
              Group overrides
            </TabsTrigger>
            <TabsTrigger value='members' variant='outline'>
              <User />
              Member overrides
            </TabsTrigger>
          </TabsList>
        }>
        {!canEdit && (
          <div className='p-3 sm:p-6 sm:pb-0'>
            <UpgradeBanner
              title='Upgrade to configure permissions'
              description='Granular permissions let you tailor access per role, group, and member.'
            />
          </div>
        )}
        <TabsContent value='baseline' className='flex flex-1 flex-col'>
          <MemberBaselineTab disabled={!canEdit} />
        </TabsContent>
        <TabsContent value='groups' className='flex flex-1 flex-col'>
          <GranteeOverridesTab granteeType='group' disabled={!canEdit} />
        </TabsContent>
        <TabsContent value='members' className='flex flex-1 flex-col'>
          <GranteeOverridesTab granteeType='user' disabled={!canEdit} />
        </TabsContent>
      </SettingsPage>
    </Tabs>
  )
}
