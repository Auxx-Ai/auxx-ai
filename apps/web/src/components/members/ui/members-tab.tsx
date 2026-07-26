// apps/web/src/components/members/ui/members-tab.tsx
'use client'

import { OrganizationRole as Role } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
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
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListCard, type ListCardMenuItem } from '@auxx/ui/components/list-card'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Copy, Send, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { Tooltip } from '~/components/global/tooltip'
import { ListSelectionProvider, useBulkMode, useListSelection } from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { seatLabel, useMemberProfiles } from '../hooks'
import type { DisplayMember, Member, PendingInvitation } from '../types'
import { MemberCard } from './member-card'
import { MemberSeatSelect } from './member-seat-select'
import { MembersBulkBar } from './members-bulk-bar'

const ROLE_ORDER: Record<string, number> = {
  [Role.OWNER]: 0,
  [Role.ADMIN]: 1,
  [Role.USER]: 2,
  PENDING: 3,
}

/**
 * Members tab body — active members merged with pending invitations, searchable,
 * with role-gated per-row actions. Hosts the change-role / change-seat / remove /
 * cancel-invite dialogs. Ported from the former `settings/members/_components`.
 */
export function MembersTab() {
  return (
    <ListSelectionProvider>
      <MembersTabInner />
    </ListSelectionProvider>
  )
}

function MembersTabInner() {
  const { userId, role: currentUserRole } = useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const utils = api.useUtils()

  const { data: membersData, isLoading } = api.member.all.useQuery()
  const { data: pendingInvitations = [] } = api.member.invitations.useQuery()
  const members = (membersData?.members ?? []) as unknown as Member[]

  const [search, setSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
  const [newRole, setNewRole] = useState<OrganizationRole | null>(null)
  const [isSeatDialogOpen, setIsSeatDialogOpen] = useState(false)
  const [newSeatType, setNewSeatType] = useState<SeatType>('full')
  const [confirm, ConfirmDialog] = useConfirm()

  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)
  const setItemIds = useListSelection((s) => s.setItemIds)
  const { resolveMemberProfile } = useMemberProfiles()

  const refreshMembers = () => {
    utils.member.all.invalidate()
    utils.member.invitations.invalidate()
    utils.member.activeCount.invalidate()
  }

  const removeUser = api.member.remove.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Member removed' })
      refreshMembers()
    },
    onError: (error) => toastError({ title: 'Error removing member', description: error.message }),
  })
  const updateRole = api.member.updateRole.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Role updated', description: `Member role updated to ${newRole}.` })
      setIsRoleDialogOpen(false)
      refreshMembers()
    },
    onError: (error) => toastError({ title: 'Error', description: error.message }),
  })
  const updateSeatType = api.member.updateSeatType.useMutation({
    onSuccess: () => {
      setIsSeatDialogOpen(false)
      refreshMembers()
    },
    onError: (error) =>
      toastError({ title: 'Error updating seat type', description: error.message }),
  })
  const cancelInvite = api.member.cancelInvitation.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Invitation cancelled' })
      refreshMembers()
    },
    onError: (error) =>
      toastError({ title: 'Error cancelling invitation', description: error.message }),
  })
  const resendInvite = api.member.resendInvitation.useMutation({
    onSuccess: (data) => {
      toastSuccess({ description: data.message || 'Invitation resent' })
      refreshMembers()
    },
    onError: (error) =>
      toastError({ title: 'Error resending invitation', description: error.message }),
  })
  const copyInviteLink = api.member.getInvitationLink.useMutation({
    onSuccess: async (data) => {
      if (data?.link) {
        try {
          await navigator.clipboard.writeText(data.link)
          toastSuccess({ description: 'Invitation link copied!' })
        } catch {
          toastError({ title: 'Copy failed', description: 'Could not copy link to clipboard.' })
        }
      } else {
        toastError({ title: 'Error', description: 'Could not retrieve link data.' })
      }
    },
    onError: (error) => toastError({ title: 'Error getting link', description: error.message }),
  })

  const handleRemoveMember = async (member: Member) => {
    const confirmed = await confirm({
      title: 'Remove member?',
      description: `Remove ${member.user.name || member.user.email} from this organization? They will lose all access.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeUser.mutate({ memberId: member.userId })
  }

  const handleCancelInvite = async (invitation: PendingInvitation) => {
    const confirmed = await confirm({
      title: 'Cancel invitation?',
      description: `Cancel the invitation sent to ${invitation.email}? They will no longer be able to join using the previous link.`,
      confirmText: 'Cancel Invitation',
      cancelText: 'Keep',
      destructive: true,
    })
    if (confirmed) cancelInvite.mutate({ invitationId: invitation.id })
  }
  const handleUpdateRole = async () => {
    if (!selectedMember || !newRole) return
    await updateRole.mutateAsync({ memberId: selectedMember.userId, role: newRole })
  }
  const handleUpdateSeatType = async () => {
    if (!selectedMember || newSeatType === selectedMember.seatType) return
    // Demoting a full member to a field seat strips them to the field-seat surface
    // (schedule + assigned jobs). Confirm first (invariant §2.A keeps Admin/Owner
    // promotions blocked while they hold a field seat).
    if (selectedMember.seatType === 'full' && newSeatType === 'worker') {
      const confirmed = await confirm({
        title: 'Switch to a field seat?',
        description:
          'This limits the member to their schedule and assigned jobs — they lose access to tickets, records and other areas. You can switch them back to a full member later.',
        confirmText: 'Switch to field seat',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    await updateSeatType.mutateAsync({ memberId: selectedMember.userId, seatType: newSeatType })
  }

  const canManageUsers = currentUserRole === Role.OWNER || currentUserRole === Role.ADMIN
  const fieldSeatCount = members.filter((m) => m.seatType === 'worker').length

  // A seat change leaves the bound profile on the wrong side of §0.21, so the
  // dialog says so up front rather than letting it be discovered later.
  const selectedMemberProfile = selectedMember ? resolveMemberProfile(selectedMember) : undefined
  const seatChangeUnbindsProfile =
    !!selectedMemberProfile &&
    newSeatType !== selectedMember?.seatType &&
    selectedMemberProfile.seat !== newSeatType

  const displayList: DisplayMember[] = useMemo(() => {
    const list: DisplayMember[] = [
      ...members.map((data): DisplayMember => ({ type: 'member', data })),
      ...pendingInvitations.map((data): DisplayMember => ({ type: 'pending', data })),
    ]
    const sortKey = (item: DisplayMember): number =>
      item.type === 'member' ? (ROLE_ORDER[item.data.role] ?? 2) : (ROLE_ORDER.PENDING ?? 3)
    list.sort((a, b) => {
      const keyA = sortKey(a)
      const keyB = sortKey(b)
      if (keyA !== keyB) return keyA - keyB
      if (a.type === 'pending' && b.type === 'pending') {
        return b.data.createdAt.getTime() - a.data.createdAt.getTime()
      }
      if (a.type === 'member' && b.type === 'member') {
        const nameA = a.data.user.name || a.data.user.email || ''
        const nameB = b.data.user.name || b.data.user.email || ''
        return nameA.localeCompare(nameB)
      }
      return 0
    })
    return list
  }, [members, pendingInvitations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return displayList
    return displayList.filter((item) => {
      const haystack =
        item.type === 'member'
          ? `${item.data.user.name ?? ''} ${item.data.user.email ?? ''}`
          : item.data.email
      return haystack.toLowerCase().includes(q)
    })
  }, [displayList, search])

  /**
   * §6's `canManageTarget` rank check, mirrored client-side (degrade-only — the
   * server re-runs it). No actions on self; an Admin cannot manage another Admin
   * or an Owner.
   */
  const canManageMember = useCallback(
    (member: Member): boolean => {
      if (!canManageUsers) return false
      if (member.userId === userId) return false
      if (member.role === Role.OWNER && currentUserRole !== Role.OWNER) return false
      if (currentUserRole === Role.ADMIN && member.role === Role.ADMIN) return false
      return true
    },
    [canManageUsers, userId, currentUserRole]
  )

  /** Only manageable member rows join the selection, so "select all" is honest. */
  const selectableMembers = useMemo(
    () =>
      filtered
        .filter((item): item is { type: 'member'; data: Member } => item.type === 'member')
        .map((item) => item.data)
        .filter(canManageMember),
    [filtered, canManageMember]
  )

  useEffect(() => {
    setItemIds(selectableMembers.map((m) => m.userId))
  }, [selectableMembers, setItemIds])

  /** Build the role-gated dropdown for one row; undefined → no menu. */
  const buildMenuItems = (item: DisplayMember): ListCardMenuItem[] | undefined => {
    if (!canManageUsers) return undefined

    if (item.type === 'pending') {
      return [
        {
          label: resendInvite.isPending ? 'Resending...' : 'Resend Invitation',
          icon: <Send />,
          disabled: resendInvite.isPending || cancelInvite.isPending,
          onClick: () => resendInvite.mutate({ invitationId: item.data.id }),
        },
        {
          label: 'Copy Invite Link',
          icon: <Copy />,
          disabled: copyInviteLink.isPending,
          onClick: () => copyInviteLink.mutate({ invitationId: item.data.id }),
        },
        {
          label: 'Cancel Invitation',
          icon: <Trash2 />,
          destructive: true,
          disabled: cancelInvite.isPending,
          onClick: () => handleCancelInvite(item.data),
        },
      ]
    }

    const member = item.data
    if (!canManageMember(member)) return undefined

    const canChangeRoleOrRemove =
      currentUserRole === Role.OWNER ||
      (currentUserRole === Role.ADMIN && member.role === Role.USER)

    const items: ListCardMenuItem[] = []
    if (canChangeRoleOrRemove) {
      items.push({
        label: 'Change role',
        onClick: () => {
          setSelectedMember(member)
          setNewRole(member.role)
          setIsRoleDialogOpen(true)
        },
      })
    }
    // Only Members (role USER) can hold a field seat (invariant §2.A). This is
    // the ONLY surface that moves a member between seat classes — a billing
    // event, cap-checked server-side (§0.21/§4.3).
    if (member.role === Role.USER) {
      items.push({
        label: 'Change seat',
        onClick: () => {
          setSelectedMember(member)
          setNewSeatType(member.seatType)
          setIsSeatDialogOpen(true)
        },
      })
    }
    if (canChangeRoleOrRemove) {
      items.push({
        label: 'Remove Member',
        destructive: true,
        onClick: () => handleRemoveMember(member),
      })
    }
    return items.length > 0 ? items : undefined
  }

  return (
    <div className='flex flex-1 flex-col'>
      <ListToolbar sticky={false}>
        <InputSearch
          value={search}
          placeholder='Search members...'
          onChange={(e) => setSearch(e.target.value)}
        />
        <ListToolbarGroup align='end'>
          {fieldSeatCount > 0 && (
            <span className='shrink-0 text-xs text-muted-foreground'>
              {fieldSeatCount} field {fieldSeatCount === 1 ? 'seat' : 'seats'}
            </span>
          )}
          {selectableMembers.length > 0 && (
            <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />
          )}
        </ListToolbarGroup>
      </ListToolbar>

      <div className='p-3 sm:p-6'>
        {isLoading ? (
          <div className='space-y-2'>
            {[...Array(6)].map((_, i) => (
              <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title='No members found'
            description={
              search ? 'Try adjusting your search terms' : 'Invite people to your organization'
            }
          />
        ) : (
          <div className='space-y-2'>
            {filtered.map((item) => (
              <MemberCard
                key={item.data.id}
                item={item}
                isSelf={item.type === 'member' && item.data.userId === userId}
                menuItems={buildMenuItems(item)}
                selectable={item.type === 'member' && canManageMember(item.data)}
                profile={item.type === 'member' ? resolveMemberProfile(item.data) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Change role */}
      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent position='tc'>
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
                  {currentUserRole === Role.OWNER && (
                    <SelectItem value={Role.OWNER} disabled={selectedMember?.seatType === 'worker'}>
                      Owner
                    </SelectItem>
                  )}
                  <SelectItem value={Role.ADMIN} disabled={selectedMember?.seatType === 'worker'}>
                    Admin
                  </SelectItem>
                  <SelectItem value={Role.USER}>User</SelectItem>
                </SelectContent>
              </Select>
              {selectedMember?.seatType === 'worker' ? (
                <Tooltip content='Field seats are always members — change to Full member first.'>
                  <p className='text-xs text-muted-foreground'>
                    Field seats are always members — change to Full member first to promote.
                  </p>
                </Tooltip>
              ) : (
                <p className='text-xs text-muted-foreground'>
                  {newRole === Role.OWNER
                    ? 'Owners have full control over the organization and can manage all settings and members.'
                    : newRole === Role.ADMIN
                      ? 'Admins can manage organization settings and members but cannot delete the organization.'
                      : 'Users have standard access to the organization.'}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsRoleDialogOpen(false)}
              disabled={updateRole.isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              data-dialog-submit
              onClick={handleUpdateRole}
              size='sm'
              variant='outline'
              disabled={updateRole.isPending || !newRole || newRole === selectedMember?.role}
              loading={updateRole.isPending}
              loadingText='Updating...'>
              Update role <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change seat — the one billing-affecting action, cap-checked server-side */}
      <Dialog open={isSeatDialogOpen} onOpenChange={setIsSeatDialogOpen}>
        <DialogContent position='tc'>
          <DialogHeader>
            <DialogTitle>Change seat</DialogTitle>
            <DialogDescription>
              Choose the seat for{' '}
              <Badge variant='user' size='sm'>
                {selectedMember?.user.name || selectedMember?.user.email}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-2'>
            <MemberSeatSelect value={newSeatType} onChange={setNewSeatType} />
            <p className='text-xs text-muted-foreground'>
              Field seats are always members and are limited to their schedule and assigned jobs.
              This changes what the organization is billed for and is checked against your plan's
              seat limit.
            </p>
            {seatChangeUnbindsProfile && (
              <p className='text-xs text-amber-600'>
                {selectedMember?.user.name || 'This member'} is on the {selectedMemberProfile?.name}{' '}
                profile, which is a {seatLabel(selectedMemberProfile?.seat ?? 'full')} profile.
                After the seat change you will need to pick a {seatLabel(newSeatType)} profile for
                them — a profile can never carry a member across seat classes.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsSeatDialogOpen(false)}
              disabled={updateSeatType.isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              data-dialog-submit
              onClick={handleUpdateSeatType}
              size='sm'
              variant='outline'
              disabled={updateSeatType.isPending || newSeatType === selectedMember?.seatType}
              loading={updateSeatType.isPending}
              loadingText='Updating...'>
              Update seat <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MembersBulkBar members={members} />
      <ConfirmDialog />
    </div>
  )
}
