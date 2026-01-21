// apps/web/src/components/groups/ui/user-member-list.tsx
'use client'

import { useState } from 'react'
import { api } from '~/trpc/react'
import { Search, MoreVertical, UserPlus, Users } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useConfirm } from '~/hooks/use-confirm'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@auxx/ui/components/empty'
import { useGroupMembers, useGroupMutations } from '../hooks'
import { getInitials } from '../utils'
import { MemberType } from '@auxx/lib/groups/client'

/** Props for UserMemberList component */
interface UserMemberListProps {
  /** Group ID */
  groupId: string
  /** Whether user can manage members */
  canManage: boolean
}

/**
 * User members table component
 * Displays and manages user members of a group
 */
export function UserMemberList({ groupId, canManage }: UserMemberListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: members, isLoading, refetch } = useGroupMembers(groupId)
  const { addMembers, removeMembers } = useGroupMutations()

  // Filter to only user members
  const userMembers = (members ?? []).filter((m) => m.memberType === MemberType.user && m.user)

  // Query to get all organization members for adding to the group
  const { data: organizationData } = api.member.all.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  })

  // Filter out members already in the group
  const existingUserIds = new Set(userMembers.map((m) => m.memberRefId))
  const availableMembers = (organizationData?.members || []).filter(
    (m) => !existingUserIds.has(m.userId)
  )

  /** Toggle selection of a member */
  const toggleSelectMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  /** Handle adding selected members */
  const handleAddMembers = async () => {
    if (selectedMembers.length === 0) {
      toastError({ title: 'Please select at least one member to add' })
      return
    }

    try {
      await addMembers.mutateAsync({
        groupId,
        members: selectedMembers.map((id) => ({ type: MemberType.user, id })),
      })
      toastSuccess({ title: `${selectedMembers.length} members added to group` })
      setIsAddMemberDialogOpen(false)
      setSelectedMembers([])
      refetch()
    } catch (error) {
      toastError({
        title: 'Error adding members',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /** Handle removing a member */
  const handleRemoveMember = async (userId: string) => {
    const confirmed = await confirm({
      title: 'Remove Member?',
      description: 'Are you sure you want to remove this member from the group?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await removeMembers.mutateAsync({
          groupId,
          members: [{ type: MemberType.user, id: userId }],
        })
        toastSuccess({ title: 'Member removed from group' })
        refetch()
      } catch (error) {
        toastError({
          title: 'Error removing member',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              className="rounded-lg"
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.preventDefault()
                setIsAddMemberDialogOpen(true)
              }}>
              <UserPlus />
              Add Members
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}

      <div className="rounded-2xl border bg-card">
        {isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : userMembers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">No user members found</p>
            {canManage && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={(e) => {
                  e.preventDefault()
                  setIsAddMemberDialogOpen(true)
                }}>
                <UserPlus />
                Add Members
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                {canManage && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {userMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Avatar>
                      <AvatarImage src={member.user?.image || undefined} alt={member.user?.name || ''} />
                      <AvatarFallback>{getInitials(member.user?.name || 'User')}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{member.user?.name || 'Unnamed User'}</TableCell>
                  <TableCell className="hidden md:table-cell">{member.user?.email}</TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleRemoveMember(member.memberRefId)}>
                            Remove from Group
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Members to Group</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search organization members..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="max-h-[400px] divide-y overflow-y-auto rounded-2xl border">
              {availableMembers.length === 0 ? (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>No members available</EmptyTitle>
                    <EmptyDescription>All organization members are already in this group</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                availableMembers.map((orgMember) => (
                  <div
                    key={orgMember.id}
                    className="flex cursor-pointer items-center p-3 hover:bg-muted/50"
                    onClick={() => toggleSelectMember(orgMember.userId)}>
                    <Checkbox
                      checked={selectedMembers.includes(orgMember.userId)}
                      className="mr-3"
                      onCheckedChange={() => toggleSelectMember(orgMember.userId)}
                    />
                    <Avatar className="mr-3">
                      <AvatarImage src={orgMember.user.image || undefined} alt={orgMember.user.name || ''} />
                      <AvatarFallback>{getInitials(orgMember.user.name || 'User')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium">{orgMember.user.name || 'Unnamed User'}</div>
                      <div className="text-sm text-muted-foreground">{orgMember.user.email}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsAddMemberDialogOpen(false)}>
              Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
            </Button>
            <Button
              data-dialog-submit
              variant="outline"
              size="sm"
              onClick={handleAddMembers}
              disabled={selectedMembers.length === 0 || addMembers.isPending}>
              Add Selected Members <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}
