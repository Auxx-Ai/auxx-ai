/*
 * src/app/(auth)/profile/_components/profile-memberships.tsx
 * Fetch and display pending invitations with accept/decline actions.
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LogOut,
  ShieldAlert,
  Shield,
  UserCircle2,
  Check,
  X as IconX,
  MailPlus,
  Loader2,
  Building,
} from 'lucide-react' // Added icons
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns' // Import if not already
import { Separator } from '@auxx/ui/components/separator' // Import Separator
import Image from 'next/image' // For inviter image
import Link from 'next/link'
import { Badge } from '@auxx/ui/components/badge'
import {
  OrganizationType as OrganizationTypeEnum,
  OrganizationRole as OrganizationRoleEnum,
} from '@auxx/database/enums'
import type { OrganizationType, OrganizationRole } from '@auxx/database/types'
// Type for existing memberships
type OrganizationMembership = {
  id: string
  name: string | null // Org name can be null initially
  type: OrganizationType
  role: OrganizationRole
}
// Type for pending invitations based on new query
type PendingInvitation = {
  id: string // Invitation ID
  role: OrganizationRole
  createdAt: Date
  expiresAt: Date
  organization: {
    id: string
    name: string | null // Org name
  }
  invitedBy: {
    id: string
    name: string | null
    image: string | null
  } | null
}
export function ProfileMemberships({ defaultOrganizationId }: { defaultOrganizationId?: string }) {
  const router = useRouter()
  const utils = api.useUtils() // Get tRPC utils for cache invalidation
  const [selectedOrgToLeave, setSelectedOrgToLeave] = useState<OrganizationMembership | null>(null)
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false)
  // --- Queries ---
  // Get existing memberships
  const {
    data: organizations,
    refetch: refetchMemberships,
    isLoading: isLoadingMemberships,
  } = api.organization.getMyOrganizations.useQuery(
    undefined, // No input needed
    { staleTime: 5 * 60 * 1000 } // Cache for 5 mins
  )
  // Get pending invitations for the current user
  const {
    data: pendingInvites,
    refetch: refetchInvites,
    isLoading: isLoadingInvites,
  } = api.organization.getMyPendingInvitations.useQuery(
    undefined, // No input needed
    { staleTime: 1 * 60 * 1000 } // Cache for 1 min
  )
  // --- Mutations ---
  const leaveOrganizationMutation = api.organization.leaveOrganization.useMutation({
    onSuccess: async () => {
      toastSuccess({
        title: 'Left organization',
        description: `You have left ${selectedOrgToLeave?.name || 'the organization'}.`,
      })
      setSelectedOrgToLeave(null) // Clear selection
      setIsLeaveDialogOpen(false)
      // Invalidate both queries
      await utils.organization.getMyOrganizations.invalidate()
      await utils.organization.getMyPendingInvitations.invalidate() // In case leaving affects invites somehow? Maybe not needed.
    },
    onError: (error) => {
      toastError({ title: 'Error leaving organization', description: error.message })
    },
  })
  const setDefaultOrgMutation = api.organization.setDefault.useMutation({
    onSuccess: async () => {
      toastSuccess({ description: 'Default organization updated' })
      // Invalidate memberships to reflect new default status
      await utils.organization.getMyOrganizations.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error setting default', description: error.message })
    },
  })
  const acceptInviteMutation = api.organization.acceptInvitationById.useMutation({
    onSuccess: async (data) => {
      toastSuccess({
        title: 'Invitation Accepted!',
        description: `You have joined the organization.`,
      })
      // Invalidate memberships and invites
      await utils.organization.getMyOrganizations.invalidate()
      await utils.organization.getMyPendingInvitations.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to accept invitation', description: error.message })
    },
  })
  // --- Handlers ---
  const handleLeaveOrganization = async () => {
    if (!selectedOrgToLeave) return
    leaveOrganizationMutation.mutate({ organizationId: selectedOrgToLeave.id })
  }
  const handleSetDefault = async (organizationId: string) => {
    setDefaultOrgMutation.mutate({ organizationId })
  }
  const handleAcceptInvite = (invitationId: string) => {
    acceptInviteMutation.mutate({ invitationId })
  }
  const handleDeclineInvite = (invitationId: string) => {
    // TODO: Implement decline logic
    console.warn('Decline action not implemented for invite:', invitationId)
    toastError({ description: 'Decline functionality not yet available.' })
    // declineInviteMutation.mutate({ invitationId });
  }
  // --- Helper ---
  const getRoleIcon = (role: OrganizationRole) => {
    console.log(role)
    switch (role) {
      case OrganizationRoleEnum.OWNER:
        return <ShieldAlert className="size-4 text-primary-500" />
      case OrganizationRoleEnum.ADMIN:
        return <Shield className="size-4 text-indigo-500" />
      case OrganizationRoleEnum.USER:
        return <UserCircle2 className="size-4 text-muted-foreground" />
    }
  }
  const formatRelativeDate = (date: Date | undefined | null): string => {
    if (!date) return '-'
    try {
      const dateObj = date instanceof Date ? date : new Date(date)
      return formatDistanceToNow(dateObj, { addSuffix: true })
    } catch (e) {
      return 'Invalid Date'
    }
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
          {pendingInvites.map((invite) => {
            const isAccepting =
              acceptInviteMutation.isPending &&
              acceptInviteMutation.variables?.invitationId === invite.id
            // const isDeclining = declineInviteMutation.isPending && declineInviteMutation.variables?.invitationId === invite.id;
            const isProcessing = isAccepting // || isDeclining;
            return (
              <div
                key={invite.id}
                className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
                <div className="flex grow items-center gap-3">
                  <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0">
                    {invite.invitedBy?.image ? (
                      <Image
                        src={invite.invitedBy.image}
                        alt={invite.invitedBy.name || 'Inviter'}
                        width={32}
                        height={32}
                        className="size-8"
                      />
                    ) : (
                      <Building className="size-4 text-primary-500" />
                    )}
                  </div>

                  <div>
                    <p className="text-sm">
                      <span className="font-medium">{invite.invitedBy?.name || 'Someone'}</span>{' '}
                      invited you to join{' '}
                      <span className="font-semibold">
                        {invite.organization.name || 'an organization'}
                      </span>{' '}
                      as a(n) <span className="font-semibold">{invite.role}</span>.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Invited {formatRelativeDate(invite.createdAt)} • Expires{' '}
                      {formatRelativeDate(invite.expiresAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleAcceptInvite(invite.id)}
                    disabled={isProcessing || isAccepting}
                    loading={isAccepting}
                    loadingText="Accepting...">
                    <Check />
                    Accept
                  </Button>
                </div>
              </div>
            )
          })}
          <Separator />
        </div>
      )}

      {/* Existing Memberships Section */}
      {!isLoading && organizations && organizations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground">
            <Building className="size-4" /> Your Organization
          </div>

          {organizations.map((org) => (
            <div
              key={org.id}
              className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
              <div className="flex flex-row items-center gap-2 ">
                <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
                  {getRoleIcon(org.role)}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {org.name || `Organization ${org.id.substring(0, 6)}`}
                    </span>{' '}
                    {/* Handle null names */}
                    {org.id === defaultOrganizationId && (
                      <Badge size="xs" variant="user">
                        Default
                      </Badge>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {org.role}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {org.type === OrganizationTypeEnum.INDIVIDUAL
                      ? 'Individual Workspace'
                      : 'Team Organization'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {org.role === OrganizationRoleEnum.OWNER && (
                  <Link href={`/app/settings/organization/delete/${org.id}`}>
                    <Button variant="destructive" size="sm">
                      <ShieldAlert />
                      Delete
                    </Button>
                  </Link>
                )}
                {org.id !== defaultOrganizationId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetDefault(org.id)}
                    disabled={
                      setDefaultOrgMutation.isPending || leaveOrganizationMutation.isPending
                    }
                    loading={
                      setDefaultOrgMutation.isPending &&
                      setDefaultOrgMutation.variables?.organizationId === org.id
                    }
                    loadingText="Setting...">
                    Make Default
                  </Button>
                )}
                {/* Logic for leaving */}
                {org.role !== OrganizationRoleEnum.OWNER || organizations.length > 1 ? ( // Simplified logic: Allow leaving if not owner OR if >1 org exists (even if owner)
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setSelectedOrgToLeave(org as OrganizationMembership)
                      setIsLeaveDialogOpen(true)
                    }} // Cast needed if types differ slightly
                    disabled={
                      setDefaultOrgMutation.isPending || leaveOrganizationMutation.isPending
                    }>
                    <LogOut />
                    Leave
                  </Button>
                ) : (
                  // Optional: Show tooltip explaining why leave is disabled
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground"
                    disabled
                    title="Cannot leave your only organization as the owner.">
                    <LogOut />
                    Leave
                  </Button>
                )}
              </div>
            </div>
          ))}
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

      {/* Leave organization dialog */}
      <Dialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave {selectedOrgToLeave?.name || 'this organization'}? You
              will lose access.
              {selectedOrgToLeave?.role === OrganizationRoleEnum.OWNER && (
                <span className="mt-2 block font-semibold text-destructive">
                  Warning: You are an Owner. Ensure ownership is transferred if necessary before
                  leaving.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsLeaveDialogOpen(false)}
              disabled={leaveOrganizationMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeaveOrganization}
              disabled={leaveOrganizationMutation.isPending}>
              {leaveOrganizationMutation.isPending ? 'Leaving...' : 'Leave Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
