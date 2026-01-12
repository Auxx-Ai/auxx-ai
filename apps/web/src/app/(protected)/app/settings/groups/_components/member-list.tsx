'use client'
// /app/(protected)/app/settings/groups/_components/member-list.tsx
import { useState } from 'react'
import { api } from '~/trpc/react'
import { Search, MoreVertical, UserPlus, Check, X, Users } from 'lucide-react'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useConfirm } from '~/hooks/use-confirm'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@auxx/ui/components/empty'

interface MemberListProps {
  groupId: string
  // onDialogOpen: (isOpen: boolean) => void
}

export function MemberList({ groupId }: MemberListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  // hasAccess()
  const utils = api.useUtils()

  // Query to get members of the group
  const { data, isLoading, refetch } = api.group.allMembers.useQuery({
    groupId,
    includeInactive,
    searchQuery,
  })

  const members = data?.members || []

  // Query to get all organization members for adding to the group
  const { data: organizationData } = api.organization.allMembers.useQuery(
    { excludeGroupId: groupId },
    { staleTime: 1000 * 60 * 5 } // 5 minutes
  )

  const organizationMembers = organizationData?.members || []

  // Add member mutation
  const addMemberMutation = api.group.addMember.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Member added to group' })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error adding member', description: error.message })
    },
  })

  // Add multiple members mutation
  const addMembersMutation = api.group.addMembers.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: `${data.stats.added + data.stats.reactivated} members added to group` })
      refetch()
      // onDialogOpen(false)
      setIsAddMemberDialogOpen(false)
      setSelectedMembers([])
    },
    onError: (error) => {
      toastError({ title: 'Error adding members', description: error.message })
    },
  })

  // Remove member mutation
  const removeMemberMutation = api.group.removeMember.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Member removed from group' })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error removing member', description: error.message })
    },
  })

  // Update member status mutation
  const updateMemberStatusMutation = api.group.updateMemberStatus.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: `Member ${data.action}` })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error updating member status', description: error.message })
    },
  })

  // Handle member selection
  const toggleSelectMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const selectAllMembers = () => {
    if (members.length === selectedMembers.length) {
      setSelectedMembers([])
    } else {
      setSelectedMembers(members.map((member) => member.userId))
    }
  }

  // Handle member addition
  const handleAddMembers = () => {
    if (selectedMembers.length === 0) {
      toastError({ title: 'Please select at least one member to add' })
      return
    }

    addMembersMutation.mutate({ groupId, userIds: selectedMembers })
  }

  // Handle member removal
  const handleRemoveMember = async (userId: string) => {
    const confirmed = await confirm({
      title: 'Remove Member?',
      description:
        'Are you sure you want to remove this member from the group? This action cannot be undone.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      removeMemberMutation.mutate({ groupId, userId })
    }
  }

  // Handle member status update
  const handleUpdateMemberStatus = (userId: string, isActive: boolean) => {
    updateMemberStatusMutation.mutate({ groupId, userId, isActive })
  }

  // Register Meta+Enter submit handler for Add Members dialog
  useDialogSubmit({
    onSubmit: handleAddMembers,
    disabled: selectedMembers.length === 0 || addMembersMutation.isPending,
  })

  // Helper function to get user initials
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-2xl border bg-card">
        {isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">No members found</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={(e) => {
                // onDialogOpen(true)
                e.preventDefault()

                setIsAddMemberDialogOpen(true)
              }}>
              <UserPlus />
              Add Members
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={members.length > 0 && selectedMembers.length === members.length}
                    onCheckedChange={selectAllMembers}
                  />
                </TableHead>
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedMembers.includes(member.userId)}
                      onCheckedChange={() => toggleSelectMember(member.userId)}
                    />
                  </TableCell>
                  <TableCell>
                    <Avatar>
                      <AvatarImage
                        src={member.user.image || undefined}
                        alt={member.user.name || ''}
                      />
                      <AvatarFallback>{getInitials(member.user.name || 'User')}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">
                    {member.user.name || 'Unnamed User'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{member.user.email}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        member.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-800/20 dark:text-green-300'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800/20 dark:text-yellow-300'
                      }`}>
                      {member.isActive ? 'Active' : 'Inactive'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {member.isActive ? (
                          <DropdownMenuItem
                            onClick={() => handleUpdateMemberStatus(member.userId, false)}>
                            <X className="text-yellow-500" />
                            Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleUpdateMemberStatus(member.userId, true)}>
                            <Check className="text-green-500" />
                            Activate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleRemoveMember(member.userId)}>
                          Remove from Group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-inactive"
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(!!checked)}
          />
          <label htmlFor="show-inactive" className="cursor-pointer text-sm text-muted-foreground">
            Show inactive members
          </label>
        </div>

        <div className="text-sm text-muted-foreground">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </div>
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
              {organizationMembers.length === 0 ? (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>No members available</EmptyTitle>
                    <EmptyDescription>
                      All organization members are already in this group
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                organizationMembers.map((orgMember) => (
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
                      <AvatarImage
                        src={orgMember.user.image || undefined}
                        alt={orgMember.user.name || ''}
                      />
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
              variant="outline"
              size="sm"
              onClick={handleAddMembers}
              disabled={selectedMembers.length === 0 || addMembersMutation.isPending}>
              Add Selected Members <KbdSubmit variant="outline" size="sm" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}
