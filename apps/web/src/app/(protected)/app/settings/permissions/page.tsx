// apps/web/src/app/(protected)/app/settings/permissions/page.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { FeatureKey } from '@auxx/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Folder, IdCard, Library, ShieldCheck, User } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import SettingsPage from '~/components/global/settings-page'
import { GranteeOverridesTab } from '~/components/permissions/ui/grantee-overrides-tab'
import { ProfilesTab } from '~/components/permissions/ui/profile-tab'
import { WorkspaceDefaultsTab } from '~/components/permissions/ui/workspace-defaults-tab'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Permissions settings — configures org-wide member access (v2 §1). Admin-only;
 * editing is gated by the `granularPermissions` plan feature (else the grids are
 * read-only under an upgrade banner).
 *
 * Four tabs, each owning ONE tier and no tier owned twice:
 *
 * - **Profiles** (doc 19 §7) — every `PermissionGrant` `profile` row: the
 *   per-area composition BASE, saved as one transactional mutation so the §6.1
 *   escalation guard can compare each holder's resulting state. The org's
 *   `member` profile lives here and **only** here; it is the org-wide member
 *   baseline by definition (§0.8).
 * - **Workspace defaults** — the `role:org_member` `ResourceAccess` rows: the
 *   per-record-type and per-instance defaults (Layer 3 / Part B). A different
 *   table and a still-live mechanism, despite the shared `org_member` address.
 * - **Group overrides** / **Member overrides** — the two raise-only
 *   `PermissionGrant` override tiers, writing sparse level maps through the
 *   grant service.
 *
 * Until this change "Member baseline" was a fifth surface that ALSO wrote the
 * `member` profile's area levels, through a `role:org_member` bridge and
 * `setGranteeLevels` — which ran no escalation guard at the time. Its grid is
 * gone; the tab kept only the `ResourceAccess` rows it was the sole host of.
 * (`setGranteeLevels` is guarded on its `user` tier since plan 37, but a profile
 * base still belongs to the Profiles tab: it moves every holder at once.)
 */
export default function PermissionsPage() {
  // NOT a role gate: `Area.permissions` left `adminOnly` in doc 19 §0.25
  // precisely so it could be delegated, and a role gate here made that lever do
  // nothing — a member granted `permissions: Full` bounced off their own area.
  useRequireCapability(PermissionKey.permissionsManage)
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
            <TabsTrigger value='defaults' variant='outline'>
              <Library />
              Workspace defaults
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
        <TabsContent value='defaults' className='flex flex-1 flex-col'>
          <WorkspaceDefaultsTab disabled={!canEdit} />
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
