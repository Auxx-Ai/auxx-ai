// src/app/(auth)/app/settings/members/page.tsx
import React from 'react'
import SettingsPage from '~/components/global/settings-page'
import { auth } from '~/auth/server'
import { MemberList } from './_components/member-list'
import { database as db } from '@auxx/database'
import { redirect } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import { Plus, RefreshCw } from 'lucide-react'
import InviteFormPopover from './_components/invite-popover'
import { api } from '~/trpc/server'
import { Tooltip } from '~/components/global/tooltip'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import { FeatureKey } from '@auxx/lib/types'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { headers } from 'next/headers'
import { OrganizationRole, OrganizationType } from '@auxx/database/enums'

type Props = {}

export default async function MembersPage({}: Props) {
  const session = await auth.api.getSession({ headers: await headers() })
  const defaultOrganizationId = session?.user?.defaultOrganizationId

  // Get data using new tRPC procedures
  const activeMemberCount = await api.organization.getActiveMemberCount()
  const organization = await api.member.getOrganizationDetails()
  const members = await api.member.all()
  const invitations = await api.member.invitations()

  if (!organization) {
    console.error(`Organization not found for ID: ${defaultOrganizationId}. Redirecting.`)
    redirect('/app?error=org_not_found')
  }

  const features = new FeaturePermissionService(db)
  const hasAccess = await features.hasAccess(defaultOrganizationId!, FeatureKey.TEAMMATES)
  const limit = await features.getLimit(defaultOrganizationId!, FeatureKey.TEAMMATES)

  // Get user's role in this organization
  const userMembership = members.find((member) => member.userId === session.user.id)

  if (!userMembership) {
    console.log('no user membership')
    redirect('/app?error=membership_mismatch')
  }

  const isAdmin =
    userMembership.role === OrganizationRole.ADMIN || userMembership.role === OrganizationRole.OWNER

  // Individual workspaces don't need a members page
  if (organization.type === OrganizationType.INDIVIDUAL) {
    // console.log('invidivual org')
    // redirect('/app/settings')
  }
  return (
    <SettingsPage
      title="Members"
      description="Members of your organization"
      breadcrumbs={[{ title: 'Settings', href: '/settings' }, { title: 'Members' }]}
      button={
        hasAccess && limit > activeMemberCount ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/settings/members">
                <RefreshCw />
                Refresh
              </Link>
            </Button>
            <InviteFormPopover>
              <Button size="sm">
                <Plus />
                Invite Member
              </Button>
            </InviteFormPopover>
          </div>
        ) : (
          <div>
            <Tooltip content="You have reached the maximum number of members allowed for your plan.">
              <Button size="sm" variant="outline" className="opacity-50">
                <Plus />
                Invite Member
              </Button>
            </Tooltip>
          </div>
        )
      }>
      {!(hasAccess && limit > activeMemberCount) && <UpgradeBanner />}
      <div className="">
        <MemberList
          userId={session?.user?.id}
          organizationId={defaultOrganizationId}
          currentUserRole={userMembership.role}
          members={members}
          pendingInvitations={invitations}
        />
      </div>
    </SettingsPage>
  )
}
