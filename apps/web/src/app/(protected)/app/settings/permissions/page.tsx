// apps/web/src/app/(protected)/app/settings/permissions/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Folder, IdCard, ShieldCheck, User, Users } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import SettingsPage from '~/components/global/settings-page'
import { GranteeOverridesTab } from '~/components/permissions/ui/grantee-overrides-tab'
import { MemberBaselineTab } from '~/components/permissions/ui/member-baseline-tab'
import { ProfilesTab } from '~/components/permissions/ui/profile-tab'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Permissions settings — configures org-wide member access (v2 §1). Admin-only;
 * editing is gated by the `granularPermissions` plan feature (else the grid is
 * read-only under an upgrade banner). Three leveled surfaces: the member
 * baseline, group overrides, and per-member overrides, each writing sparse grant
 * rows through the grant service.
 *
 * The two `GranteeOverridesTab` mounts are `group` and `user` — the only two
 * *override* tiers. `PermissionGrant` also carries `granteeType:'profile'` rows
 * (doc 19 §0.1), but a profile is the composition BASE, not a raise above it, so
 * it is not a third override tab: the Member profile is presented here as the
 * "Member baseline" tab via `permissions-member-baseline.ts`, and the remaining
 * profiles get their own editor.
 *
 * The **Profiles** tab (doc 19 §7) is the editor for those `profile` rows: the
 * list of every profile in the org plus the human editor (identity, per-area
 * base, intrinsic ceiling) saved as ONE transactional mutation. `profileGrants`
 * in `usePermissionGrants` is where its area levels are read from.
 *
 * TODO(plan-19-step-7): retitle "Member baseline" to the Member-profile editor
 * and delete `permissions-member-baseline.ts` — until then the org's `member`
 * profile is addressed as `role:org_member` by that tab AND surfaced (correctly)
 * as a profile on the Profiles tab, which reads its levels through the same
 * bridge.
 */
export default function PermissionsPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const [tab, setTab] = useQueryState('t', { defaultValue: 'profiles' })
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
          <TabsList variant='outline' className='border-b-0'>
            <TabsTrigger value='profiles' variant='outline'>
              <IdCard />
              Profiles
            </TabsTrigger>
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
        <TabsContent value='profiles' className='flex flex-1 flex-col'>
          <ProfilesTab disabled={!canEdit} />
        </TabsContent>
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
