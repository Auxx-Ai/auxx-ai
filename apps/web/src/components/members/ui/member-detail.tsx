// apps/web/src/components/members/ui/member-detail.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Users } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { SeatTypeBadge } from '~/components/permissions/ui/seat-type-badge'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import type { Member } from '../types'
import { getInitials, RoleIcon } from '../utils'
import { MemberAccountsSection } from './member-accounts-section'
import { MemberDangerSection } from './member-danger-section'
import { MemberTeamsSection } from './member-teams-section'

const BREADCRUMBS_BASE = [
  { title: 'Settings', href: '/app/settings' },
  { title: 'Members', href: '/app/settings/members' },
]

/**
 * Member detail page — the avatar/name/email/role live in the SettingsPage
 * header itself (read-only), with Teams, Accounts, and a danger zone below.
 * Reads the member from the already-cached `member.all` list (no new endpoint).
 */
export function MemberDetail({ userId }: { userId: string }) {
  const { userId: viewerId, role: viewerRole } = useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { data, isLoading } = api.member.all.useQuery()
  const members = (data?.members ?? []) as unknown as Member[]
  const member = members.find((m) => m.userId === userId)

  if (isLoading) {
    return (
      <SettingsPage
        title={<Skeleton className='h-5 w-40' />}
        breadcrumbs={[...BREADCRUMBS_BASE, { title: 'Member', loading: true }]}
        backLink='/app/settings/members'>
        <div className='space-y-8 p-3 sm:p-6'>
          <Skeleton className='h-40 w-full rounded-2xl' />
        </div>
      </SettingsPage>
    )
  }

  if (!member) {
    return (
      <SettingsPage
        title='Member not found'
        breadcrumbs={[...BREADCRUMBS_BASE, { title: 'Not found' }]}
        backLink='/app/settings/members'>
        <div className='flex flex-1 flex-col items-center justify-center py-16'>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Users />
              </EmptyMedia>
              <EmptyTitle>Member not found</EmptyTitle>
              <EmptyDescription>
                This member may have been removed from the organization.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </SettingsPage>
    )
  }

  const isSelf = member.userId === viewerId
  const displayName = member.user.name || member.user.email || 'Unnamed User'

  return (
    <SettingsPage
      icon={
        <Avatar className='size-10 rounded-full'>
          {member.user.image && (
            <AvatarImage src={member.user.image} alt={member.user.name ?? ''} />
          )}
          <AvatarFallback>{getInitials(member.user.name, member.user.email)}</AvatarFallback>
        </Avatar>
      }
      title={
        <span className='inline-flex items-center gap-1.5'>
          {member.user.name || 'Unnamed User'}
          {isSelf && <span className='text-xs font-normal text-muted-foreground'>(You)</span>}
        </span>
      }
      description={member.user.email}
      button={
        <div className='flex items-center gap-1.5'>
          <Badge variant='user' size='xs'>
            <RoleIcon role={member.role} />
            <span>{member.role}</span>
          </Badge>
          <SeatTypeBadge seatType={member.seatType} />
        </div>
      }
      breadcrumbs={[...BREADCRUMBS_BASE, { title: displayName }]}
      backLink='/app/settings/members'>
      <div className='space-y-8 p-3 sm:p-6'>
        <MemberTeamsSection member={member} />
        <MemberAccountsSection userId={member.userId} />
        <MemberDangerSection member={member} viewerRole={viewerRole} viewerId={viewerId} />
      </div>
    </SettingsPage>
  )
}
