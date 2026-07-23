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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { InputSearch } from '@auxx/ui/components/input-search'
import type { ListCardMenuItem } from '@auxx/ui/components/list-card'
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
import { useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { SeatTypeSelect } from '~/components/permissions/ui/seat-type-select'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import type { DisplayMember, Member, PendingInvitation } from '../types'
import { MemberCard } from './member-card'

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
  const { userId, role: currentUserRole } = useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const utils = api.useUtils()

  const { data: membersData } = api.member.all.useQuery()
  const { data: pendingInvitations = [] } = api.member.invitations.useQuery()
  const members = (membersData?.members ?? []) as unknown as Member[]

  const [search, setSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [selectedInvitation, setSelectedInvitation] = useState<PendingInvitation | null>(null)
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false)
  const [isCancelInviteDialogOpen, setIsCancelInviteDialogOpen] = useState(false)
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
  const [newRole, setNewRole] = useState<OrganizationRole | null>(null)
  const [isSeatDialogOpen, setIsSeatDialogOpen] = useState(false)
  const [newSeatType, setNewSeatType] = useState<SeatType>('full')
  const [confirm, ConfirmDialog] = useConfirm()

  const refreshMembers = () => {
    utils.member.all.invalidate()
    utils.member.invitations.invalidate()
    utils.member.activeCount.invalidate()
  }

  const removeUser = api.member.remove.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Member removed' })
      setIsRemoveDialogOpen(false)
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
      setIsCancelInviteDialogOpen(false)
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

  const handleRemoveMember = async () => {
    if (!selectedMember) return
    await removeUser.mutateAsync({ memberId: selectedMember.userId })
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
          onClick: () => {
            setSelectedInvitation(item.data)
            setIsCancelInviteDialogOpen(true)
          },
        },
      ]
    }

    const member = item.data
    // No actions on self; Admins can't manage other Admins/Owners.
    if (member.userId === userId) return undefined
    if (member.role === Role.OWNER && currentUserRole !== Role.OWNER) return undefined
    if (currentUserRole === Role.ADMIN && member.role === Role.ADMIN) return undefined

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
    // Only Members (role USER) can hold a field seat (invariant §2.A).
    if (member.role === Role.USER) {
      items.push({
        label: 'Change seat type',
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
        onClick: () => {
          setSelectedMember(member)
          setIsRemoveDialogOpen(true)
        },
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
        </ListToolbarGroup>
      </ListToolbar>

      <div className='p-3 sm:p-6'>
        {filtered.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center py-8'>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No members found</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? 'Try adjusting your search terms'
                    : 'Invite people to your organization'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className='space-y-2'>
            {filtered.map((item) => (
              <MemberCard
                key={item.data.id}
                item={item}
                isSelf={item.type === 'member' && item.data.userId === userId}
                menuItems={buildMenuItems(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Remove member confirmation */}
      <Dialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              {selectedMember?.user.name || selectedMember?.user.email} from this organization?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsRemoveDialogOpen(false)}
              disabled={removeUser.isPending}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveMember}
              loading={removeUser.isPending}
              loadingText='Removing...'>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel invitation confirmation */}
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
              disabled={cancelInvite.isPending}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (selectedInvitation) cancelInvite.mutate({ invitationId: selectedInvitation.id })
              }}
              loading={cancelInvite.isPending}
              loadingText='Cancelling...'>
              Cancel Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change role */}
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
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRole}
              size='sm'
              variant='outline'
              disabled={updateRole.isPending || !newRole || newRole === selectedMember?.role}
              loading={updateRole.isPending}
              loadingText='Updating...'>
              Update role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change seat type */}
      <Dialog open={isSeatDialogOpen} onOpenChange={setIsSeatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change seat type</DialogTitle>
            <DialogDescription>
              Choose the seat for{' '}
              <Badge variant='user' size='sm'>
                {selectedMember?.user.name || selectedMember?.user.email}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-2'>
            <SeatTypeSelect value={newSeatType} onChange={setNewSeatType} />
            <p className='text-xs text-muted-foreground'>
              Field seats are always members and are limited to their schedule and assigned jobs.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsSeatDialogOpen(false)}
              disabled={updateSeatType.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateSeatType}
              size='sm'
              variant='outline'
              disabled={updateSeatType.isPending || newSeatType === selectedMember?.seatType}
              loading={updateSeatType.isPending}
              loadingText='Updating...'>
              Update seat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}
