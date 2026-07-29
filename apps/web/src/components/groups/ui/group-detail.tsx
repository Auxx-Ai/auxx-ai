// apps/web/src/components/groups/ui/group-detail.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { FeatureKey } from '@auxx/lib/types'
import { Badge } from '@auxx/ui/components/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Globe, Lock, ShieldCheck, UsersRound } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import SettingsPage from '~/components/global/settings-page'
import { GranteeLevelsSection } from '~/components/permissions/ui/grantee-levels-section'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useGroup, useGroups } from '../hooks'
import { getGroupMetadata } from '../utils'
import { GroupDangerSection } from './group-danger-section'
import { GroupGeneralSection } from './group-general-section'
import { GroupMembersSection } from './group-members-section'

const BREADCRUMBS_BASE = [
  { title: 'Settings', href: '/app/settings' },
  { title: 'Members and Groups', href: '/app/settings/members?t=groups' },
]

/**
 * Group detail page — the emoji/name/description/visibility live in the SettingsPage
 * header, with an editable General section, a Members section, and a danger zone below.
 * Reads the group from the already-cached groups list (no new endpoint).
 */
export function GroupDetail({ groupId }: { groupId: string }) {
  useRequireCapability(PermissionKey.membersManage)
  const { hasAccess } = useFeatureFlags()
  const canEditPermissions = hasAccess(FeatureKey.granularPermissions)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') === 'permissions' ? 'permissions' : 'general'
  const { isLoading } = useGroups()
  const group = useGroup(groupId)

  if (isLoading && !group) {
    return (
      <SettingsPage
        title={<Skeleton className='h-5 w-40' />}
        breadcrumbs={[...BREADCRUMBS_BASE, { title: 'Group', loading: true }]}
        backLink='/app/settings/members?t=groups'>
        <div className='space-y-8 p-3 sm:p-6'>
          <Skeleton className='h-40 w-full rounded-2xl' />
        </div>
      </SettingsPage>
    )
  }

  if (!group) {
    return (
      <SettingsPage
        title='Group not found'
        breadcrumbs={[...BREADCRUMBS_BASE, { title: 'Not found' }]}
        backLink='/app/settings/members?t=groups'>
        <div className='flex flex-1 flex-col items-center justify-center py-16'>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <UsersRound />
              </EmptyMedia>
              <EmptyTitle>Group not found</EmptyTitle>
              <EmptyDescription>This group may have been deleted.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </SettingsPage>
    )
  }

  const meta = getGroupMetadata(group)
  const isPrivate = meta.visibility === 'private'

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => router.push(`${pathname}?tab=${v}`, { scroll: false })}
      className='flex h-full min-h-0 flex-1 flex-col'>
      <SettingsPage
        icon={
          <div className='flex size-10 items-center justify-center rounded-full border text-lg'>
            {meta.icon || '👥'}
          </div>
        }
        title={group.displayName || 'Untitled group'}
        description={group.secondaryDisplayValue || undefined}
        button={
          <Badge variant='secondary' size='sm'>
            {isPrivate ? <Lock /> : <Globe />}
            <span>{isPrivate ? 'Private' : 'Public'}</span>
          </Badge>
        }
        breadcrumbs={[...BREADCRUMBS_BASE, { title: group.displayName || 'Group' }]}
        backLink='/app/settings/members?t=groups'
        subHeaderClassName='p-0'
        subHeader={
          <TabsList variant='outline'>
            <TabsTrigger value='general' variant='outline'>
              <UsersRound />
              General
            </TabsTrigger>
            <TabsTrigger value='permissions' variant='outline'>
              <ShieldCheck />
              Permissions
            </TabsTrigger>
          </TabsList>
        }>
        <TabsContent value='general'>
          <div className='space-y-8 p-3 sm:p-6'>
            <GroupGeneralSection group={group} />
            <GroupMembersSection groupId={group.id} />
            <GroupDangerSection group={group} />
          </div>
        </TabsContent>
        <TabsContent value='permissions'>
          <div className='space-y-8 p-3 sm:p-6'>
            {!canEditPermissions && (
              <UpgradeBanner
                title='Upgrade to configure permissions'
                description='Granular permissions let you set what this team can access across the workspace and per record type.'
              />
            )}
            <GranteeLevelsSection
              granteeKind='group'
              granteeId={group.id}
              canEdit={canEditPermissions}
            />
          </div>
        </TabsContent>
      </SettingsPage>
    </Tabs>
  )
}
