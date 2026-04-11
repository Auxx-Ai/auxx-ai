'use client'
import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { FeatureKey } from '@auxx/lib/types'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns' // For showing relative time
import {
  Clock,
  Copy,
  Mail,
  MoreHorizontal,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  UserCircle2,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
// src/app/(auth)/app/settings/members/_components/member-list.tsx
import { useState } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

type DisplayMember =
  | {
      type: 'member'
      data: Member
    }
  | {
      type: 'pending'
      data: PendingInvitation
    }
type Member = {
  id: string
  userId: string
  organizationId: string
  role: OrganizationRole
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  }
}
type PendingInvitation = {
  id: string
  email: string
  role: OrganizationRole
  createdAt: Date
  expiresAt: Date
  invitedBy: {
    name: string | null
    id: string
  } | null
}
interface MemberListProps {
  userId: string
  members: Member[]
  pendingInvitations: PendingInvitation[] // Pending invitations
  organizationId: string
  currentUserRole: OrganizationRole
  onMemberUpdate?: () => void
}
export function MemberList({
  userId,
  members,
  pendingInvitations,
  organizationId,
  currentUserRole,
  onMemberUpdate,
}: MemberListProps) {
  const utils = api.useUtils() // For invalidating queries
  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })
  const { features, getLimit, hasAccess, isLoading: isFeaturesLoading } = useFeatureFlags()
  const canUseTeam = hasAccess(FeatureKey.teammates)
  const teamLimit = getLimit(FeatureKey.teammates)
  console.log('Feature access:', { canUseTeam, teamLimit })
  const router = useRouter()
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [selectedInvitation, setSelectedInvitation] = useState<PendingInvitation | null>(null)
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false)
  const [isCancelInviteDialogOpen, setIsCancelInviteDialogOpen] = useState(false)
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
  const [newRole, setNewRole] = useState<OrganizationRole | null>(null)
  const [copyingInviteId, setCopyingInviteId] = useState<string | null>(null) // Track which link is being copied
  const removeUserMutation = api.member.remove.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Member removed' })
      setIsRemoveDialogOpen(false)
      onMemberUpdate?.() // Use callback
      router.refresh() // Or refresh router
    },
    onError: (error) => toastError({ title: 'Error removing member', description: error.message }),
  })
  const updateRoleMutation = api.member.updateRole.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Role updated',
        description: `Member role has been updated to ${newRole}.`,
      })
      setIsRoleDialogOpen(false)
      onMemberUpdate?.()
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })
  const cancelInviteMutation = api.member.cancelInvitation.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Invitation cancelled' })
      setIsCancelInviteDialogOpen(false)
      utils.organization.byId.invalidate({ id: organizationId }) // Invalidate cache
      onMemberUpdate?.()
    },
    onError: (error) =>
      toastError({ title: 'Error cancelling invitation', description: error.message }),
  })
  const resendInviteMutation = api.member.resendInvitation.useMutation({
    onSuccess: (data) => {
      toastSuccess({ description: data.message || 'Invitation resent' })
      onMemberUpdate?.()
    },
    onError: (error) =>
      toastError({ title: 'Error resending invitation', description: error.message }),
  })
  const getAndCopyLinkMutation = api.member.getInvitationLink.useMutation({
    // onSuccess is called with the *direct return value* of the procedure
    onSuccess: async (data) => {
      // data here is { link: "..." } as returned by the query
      if (data?.link) {
        try {
          await navigator.clipboard.writeText(data.link)
          toastSuccess({ description: 'Invitation link copied!' })
        } catch (err) {
          toastError({ title: 'Copy failed', description: 'Could not copy link to clipboard.' })
          console.error('Failed to copy text: ', err)
        }
      } else {
        // This case should ideally be caught by onError if the query throws
        toastError({ title: 'Error', description: 'Could not retrieve link data.' })
      }
    },
    onError: (error) => {
      toastError({ title: 'Error getting link', description: error.message })
    },
    // onSettled: () => {
    //   // Optional: You could reset any specific loading indicators here if needed,
    //   // but mutation.isPending handles the general loading state.
    // }
  })
  const handleRemoveMember = async () => {
    if (!selectedMember) return
    const result = await removeUserMutation.mutateAsync({ memberId: selectedMember.userId })
    router.refresh() // Refresh the page to reflect changes
  }
  const handleCancelInvite = async () => {
    if (!selectedInvitation) return
    // TODO: Implement cancel invite mutation call
    // cancelInviteMutation.mutate({ invitationId: selectedInvitation.id });
    cancelInviteMutation.mutate({ invitationId: selectedInvitation.id })
    setIsCancelInviteDialogOpen(false)
    onMemberUpdate?.()
    router.refresh()
  }
  const handleResendInvite = async (invitationId: string) => {
    // TODO: Implement resend invite mutation call
    resendInviteMutation.mutate({ invitationId })
    // No need to close dialog, happens directly from menu item
    onMemberUpdate?.()
    // No router refresh needed typically for resend unless status changes
  }
  const handleCopyInviteLink = (invitationId: string) => {
    // Prevent re-triggering while the mutation is already pending
    if (getAndCopyLinkMutation.isPending) {
      return
    }
    // Call the mutation with the required input
    getAndCopyLinkMutation.mutate({ invitationId })
  }
  const handleUpdateRole = async () => {
    if (!selectedMember || !newRole) return
    await updateRoleMutation.mutateAsync({ memberId: selectedMember.userId, role: newRole })
    router.refresh() // Refresh the page to reflect changes
  }
  // Sort members by role importance (OWNER first, then ADMIN, then USER)
  const sortedMembers = [...members].sort((a, b) => {
    const roleOrder = {
      [OrganizationRoleEnum.OWNER]: 0,
      [OrganizationRoleEnum.ADMIN]: 1,
      [OrganizationRoleEnum.USER]: 2,
    }
    return roleOrder[a.role] - roleOrder[b.role]
  })
  const canManageUsers =
    currentUserRole === OrganizationRoleEnum.OWNER || currentUserRole === OrganizationRoleEnum.ADMIN
  const displayList: DisplayMember[] = [
    ...members.map((m): DisplayMember => ({ type: 'member', data: m })),
    ...pendingInvitations.map((p): DisplayMember => ({ type: 'pending', data: p })),
  ]
  displayList.sort((a, b) => {
    const roleOrder = {
      [OrganizationRoleEnum.OWNER]: 0,
      [OrganizationRoleEnum.ADMIN]: 1,
      [OrganizationRoleEnum.USER]: 2,
      PENDING: 3, // Assign a numeric value for sorting
    }
    const getSortKey = (item: DisplayMember): number => {
      if (item.type === 'member') return roleOrder[item.data.role]
      return roleOrder.PENDING
    }
    const keyA = getSortKey(a)
    const keyB = getSortKey(b)
    if (keyA !== keyB) {
      return keyA - keyB
    }
    // If roles are the same (or both pending), sort pending by date descending, members by name ascending
    if (a.type === 'pending' && b.type === 'pending') {
      return b.data.createdAt.getTime() - a.data.createdAt.getTime() // Most recent pending first
    }
    if (a.type === 'member' && b.type === 'member') {
      const nameA = a.data.user.name || a.data.user.email || ''
      const nameB = b.data.user.name || b.data.user.email || ''
      return nameA.localeCompare(nameB)
    }
    // Keep relative order if comparing member and pending (shouldn't happen with key check)
    return 0
  })
  const getRoleIcon = (role: OrganizationRole | 'PENDING') => {
    if (role === 'PENDING') return <Clock className='size-3' />
    switch (role) {
      case OrganizationRoleEnum.OWNER:
        return <ShieldAlert className='size-3' />
      case OrganizationRoleEnum.ADMIN:
        return <Shield className='size-3' />
      case OrganizationRoleEnum.USER:
        return <UserCircle2 className='size-3' />
    }
  }
  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2)
    }
    return email?.[0].toUpperCase() || '?'
  }
  const formatRelativeDate = (date: Date | undefined | null): string => {
    if (!date) return '-'
    try {
      // Make sure it's a Date object
      const dateObj = date instanceof Date ? date : new Date(date)
      return formatDistanceToNow(dateObj, { addSuffix: true })
    } catch (e) {
      console.error('Error formatting date:', e)
      return 'Invalid Date'
    }
  }
  return (
    <div className='p-3 sm:p-6'>
      <div className='space-y-4'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          <Users className='size-4' /> Members
        </div>
        {displayList.map((item) => {
          const isCopyingThisLink =
            getAndCopyLinkMutation.isPending &&
            getAndCopyLinkMutation.variables?.invitationId === item.data.id
          return (
            <div
              key={item.data.id}
              className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
              {/* === Member Cell === */}
              <div className='flex flex-row items-center gap-4 '>
                <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                  <Avatar
                    className={`h-7 w-7 rounded-none shadow-none ${item.type === 'pending' ? 'opacity-60' : ''}`}>
                    <AvatarFallback className='rounded-none bg-transparent'>
                      {item.type === 'member'
                        ? getInitials(item.data.user.name, item.data.user.email)
                        : getInitials(undefined, item.data.email)}
                    </AvatarFallback>
                    {/* Note: No AvatarImage for pending */}
                  </Avatar>
                </div>
                <div className='flex flex-col'>
                  <div className='text-sm font-medium flex flex-row items-center gap-1'>
                    <span>
                      {item.type === 'member'
                        ? item.data.user.name || 'Unnamed User'
                        : item.data.email}
                    </span>
                    {item.type === 'member' && item.data.userId === userId && (
                      <span className='text-xs text-muted-foreground'>(You)</span>
                    )}
                    <Badge variant='user' className='ml-1' size='xs'>
                      {getRoleIcon(item.type === 'member' ? item.data.role : 'PENDING')}
                      <span>
                        {item.type === 'member' ? item.data.role : `Pending ${item.data.role}`}
                      </span>
                    </Badge>
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {item.type === 'member' ? (
                      <div className='flex items-center gap-2 '>
                        <Mail className='size-3 ' />
                        <span>{item.data.user.email}</span>
                      </div>
                    ) : (
                      <div className='flex flex-row gap-1 '>
                        <span className=''>Invited {formatRelativeDate(item.data.createdAt)}</span>
                        <span>Expires {formatRelativeDate(item.data.expiresAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* === Actions Cell === */}
              {canManageUsers && (
                <>
                  {/* --- Actions for ACTIVE Members --- */}
                  {item.type === 'member' &&
                    item.data.userId !== userId && // No actions on self
                    (item.data.role !== OrganizationRoleEnum.OWNER ||
                      currentUserRole === OrganizationRoleEnum.OWNER) && // Owner manages Owners
                    (currentUserRole !== OrganizationRoleEnum.ADMIN ||
                      item.data.role !== OrganizationRoleEnum.ADMIN) && ( // Admin cannot manage other Admins
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='icon-sm'>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          {/* Change Role */}
                          {(currentUserRole === OrganizationRoleEnum.OWNER ||
                            (currentUserRole === OrganizationRoleEnum.ADMIN &&
                              item.data.role === OrganizationRoleEnum.USER)) && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedMember(item.data)
                                setNewRole(item.data.role)
                                setIsRoleDialogOpen(true)
                              }}>
                              Change role
                            </DropdownMenuItem>
                          )}
                          {/* Separator if both actions available */}
                          {(currentUserRole === OrganizationRoleEnum.OWNER ||
                            (currentUserRole === OrganizationRoleEnum.ADMIN &&
                              item.data.role === OrganizationRoleEnum.USER)) && (
                            <DropdownMenuSeparator />
                          )}
                          {/* Remove Member */}
                          {(currentUserRole === OrganizationRoleEnum.OWNER ||
                            (currentUserRole === OrganizationRoleEnum.ADMIN &&
                              item.data.role === OrganizationRoleEnum.USER)) && (
                            <DropdownMenuItem
                              variant='destructive'
                              onClick={() => {
                                setSelectedMember(item.data)
                                setIsRemoveDialogOpen(true)
                              }}>
                              Remove Member
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                  {/* --- Actions for PENDING Invitations --- */}
                  {item.type === 'pending' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          disabled={
                            resendInviteMutation.isPending ||
                            cancelInviteMutation.isPending ||
                            getAndCopyLinkMutation.isPending
                          }
                          loading={isCopyingThisLink}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={() => handleResendInvite(item.data.id)}
                          disabled={
                            resendInviteMutation.isPending || cancelInviteMutation.isPending
                          }>
                          <Send />
                          {resendInviteMutation.isPending &&
                          resendInviteMutation.variables?.invitationId === item.data.id
                            ? 'Resending...'
                            : 'Resend Invitation'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleCopyInviteLink(item.data.id)}
                          disabled={
                            resendInviteMutation.isPending ||
                            cancelInviteMutation.isPending ||
                            getAndCopyLinkMutation.isPending
                          }>
                          <Copy />
                          {isCopyingThisLink ? 'Copying...' : 'Copy Invite Link'}
                        </DropdownMenuItem>

                        {/* TODO: Add Cancel Invite */}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => {
                            setSelectedInvitation(item.data)
                            setIsCancelInviteDialogOpen(true)
                          }}
                          disabled={
                            resendInviteMutation.isPending ||
                            cancelInviteMutation.isPending ||
                            getAndCopyLinkMutation.isPending
                          }>
                          <Trash2 /> Cancel Invitation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Remove member confirmation dialog */}
      <Dialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove
              {selectedMember?.user.name || selectedMember?.user.email} from this organization?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsRemoveDialogOpen(false)}
              disabled={removeUserMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveMember}
              disabled={removeUserMutation.isPending}>
              {removeUserMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel invitation confirmation dialog */}
      <Dialog open={isCancelInviteDialogOpen} onOpenChange={setIsCancelInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Invitation</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel the invitation sent to{' '}
              <strong>{selectedInvitation?.email}</strong>? They will no longer be able to join
              using the previous link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsCancelInviteDialogOpen(false)}
              disabled={false /* Replace with cancelInviteMutation.isPending */}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleCancelInvite}
              disabled={false /* Replace with cancelInviteMutation.isPending */}>
              {false /* Replace with cancelInviteMutation.isPending */
                ? 'Cancelling...'
                : 'Cancel Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change role dialog */}
      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change member role</DialogTitle>
            <DialogDescription>
              Update the role for{' '}
              <Badge variant='user' size='sm'>
                {selectedMember?.user.name || selectedMember?.user.email}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4'>
            <div className='space-y-2'>
              <label htmlFor='role' className='text-sm font-medium'>
                Role
              </label>
              <Select
                value={newRole || undefined}
                onValueChange={(value: OrganizationRole) => setNewRole(value)}>
                <SelectTrigger id='role'>
                  <SelectValue placeholder='Select a role' />
                </SelectTrigger>
                <SelectContent>
                  {/* Only show options the current user has permission to assign */}
                  {currentUserRole === OrganizationRoleEnum.OWNER && (
                    <SelectItem value={OrganizationRoleEnum.OWNER}>Owner</SelectItem>
                  )}
                  <SelectItem value={OrganizationRoleEnum.ADMIN}>Admin</SelectItem>
                  <SelectItem value={OrganizationRoleEnum.USER}>User</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                {newRole === OrganizationRoleEnum.OWNER
                  ? 'Owners have full control over the organization and can manage all settings and members.'
                  : newRole === OrganizationRoleEnum.ADMIN
                    ? 'Admins can manage organization settings and members but cannot delete the organization.'
                    : 'Users have standard access to the organization.'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsRoleDialogOpen(false)}
              disabled={updateRoleMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRole}
              size='sm'
              variant='outline'
              disabled={
                updateRoleMutation.isPending || !newRole || newRole === selectedMember?.role
              }
              loading={updateRoleMutation.isPending}
              loadingText='Updating...'>
              Update role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
