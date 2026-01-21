// apps/web/src/app/(protected)/app/settings/organization/_components/profile-membership.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MailPlus, Loader2, Building } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Separator } from '@auxx/ui/components/separator'
import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import {
  LeaveOrganizationDialog,
  OrganizationItem,
  PendingInvitationItem,
  type OrganizationMembership,
} from '~/components/organization'
import { useOrganization } from '~/hooks/use-organization'

/** Displays user's organization memberships and pending invitations */
export function ProfileMemberships() {
  const currentOrganization = useOrganization()
  const defaultOrganizationId = currentOrganization?.id
  const router = useRouter()
  const utils = api.useUtils()

  // Leave dialog state
  const [selectedOrgToLeave, setSelectedOrgToLeave] = useState<OrganizationMembership | null>(null)
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false)

  // Queries
  const { data: organizations, isLoading: isLoadingMemberships } = api.organization.list.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  )

  const { data: pendingInvites, isLoading: isLoadingInvites } =
    api.member.myPendingInvitations.useQuery(undefined, { staleTime: 1 * 60 * 1000 })

  // Mutations
  const leaveOrganization = api.organization.leave.useMutation({
    onSuccess: async () => {
      toastSuccess({
        title: 'Left organization',
        description: `You have left ${selectedOrgToLeave?.name || 'the organization'}.`,
      })
      setSelectedOrgToLeave(null)
      setIsLeaveDialogOpen(false)
      await utils.organization.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error leaving organization', description: error.message })
    },
  })

  const acceptInvite = api.member.acceptInvitationById.useMutation({
    onSuccess: async () => {
      toastSuccess({
        title: 'Invitation Accepted!',
        description: 'You have joined the organization.',
      })
      await utils.organization.list.invalidate()
      await utils.member.myPendingInvitations.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to accept invitation', description: error.message })
    },
  })

  const handleLeaveOrganization = () => {
    if (!selectedOrgToLeave) return
    leaveOrganization.mutate({ organizationId: selectedOrgToLeave.id })
  }

  const isLoading = isLoadingMemberships || isLoadingInvites

  return (
    <div className="p-6 space-y-6">
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading memberships...</span>
        </div>
      )}

      {/* Pending Invitations Section */}
      {!isLoading && pendingInvites && pendingInvites.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground">
            <MailPlus className="size-4" /> Pending Invitations
          </div>
          {pendingInvites.map((invite) => (
            <PendingInvitationItem
              key={invite.id}
              invitation={invite}
              onAccept={() => acceptInvite.mutate({ invitationId: invite.id })}
              isAccepting={
                acceptInvite.isPending && acceptInvite.variables?.invitationId === invite.id
              }
            />
          ))}
          <Separator />
        </div>
      )}

      {/* Existing Memberships Section */}
      {!isLoading && organizations && organizations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground">
            <Building className="size-4" /> Your Organization
          </div>

          {organizations.map((org) => {
            const isOwner = org.role === OrganizationRoleEnum.OWNER
            const canLeave = !isOwner || organizations.length > 1

            return (
              <OrganizationItem
                key={org.id}
                organization={org as OrganizationMembership}
                isDefault={org.id === defaultOrganizationId}
                canLeave={canLeave}
                onLeave={() => {
                  setSelectedOrgToLeave(org as OrganizationMembership)
                  setIsLeaveDialogOpen(true)
                }}
                isLeaving={leaveOrganization.isPending}
              />
            )
          })}
        </div>
      )}

      {/* No Memberships and No Invites */}
      {!isLoading &&
        (!organizations || organizations.length === 0) &&
        (!pendingInvites || pendingInvites.length === 0) && (
          <div className="py-6 text-center">
            <p className="text-muted-foreground">
              You don't belong to any organizations and have no pending invitations.
            </p>
            <Button className="mt-4" onClick={() => router.push('/onboarding')}>
              Create an Organization
            </Button>
          </div>
        )}

      {/* Leave Organization Dialog */}
      {isLeaveDialogOpen && (
        <LeaveOrganizationDialog
          open={isLeaveDialogOpen}
          onOpenChange={setIsLeaveDialogOpen}
          organization={selectedOrgToLeave}
          onConfirm={handleLeaveOrganization}
          isPending={leaveOrganization.isPending}
        />
      )}
    </div>
  )
}
