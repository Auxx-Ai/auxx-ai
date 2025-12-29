// /app/settings/inbox/_components/inbox-access-tab.tsx
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '~/trpc/react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import { Form } from '@auxx/ui/components/form'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { UsersIcon, X } from 'lucide-react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { InboxWithRelations } from '@auxx/lib/types'
import { useMembersGroups } from '~/hooks/use-members-groups'
import { MemberGroupFormField } from '~/components/pickers/member-group-form-picker'

// Combine member and group access into a single type for rendering
type AccessItem = { id: string; type: 'member' | 'group'; name: string; memberCount?: number }

export function InboxAccessTab({ inbox }: { inbox: InboxWithRelations }) {
  // Track local state of allowAllMembers to ensure immediate UI updates
  const [allowAllMembers, setAllowAllMembers] = useState(inbox.allowAllMembers)
  const [isUpdating, setIsUpdating] = useState(false)

  // Use the confirm hook for confirmation dialogs
  const [confirm, ConfirmDialog] = useConfirm()

  // Get access to members and groups data for reference
  const { members, groups } = useMembersGroups()

  // Get utils for invalidating queries
  const utils = api.useUtils()

  // Form setup
  const form = useForm({ defaultValues: { memberGroupSelection: { memberIds: [], groupIds: [] } } })

  // Update inbox access mutation
  const updateAccess = api.inbox.updateAccess.useMutation({
    onSuccess: () => {
      setIsUpdating(false)
      toastSuccess({
        title: 'Access updated',
        description: 'The inbox access settings have been updated successfully',
      })
      form.reset({ memberGroupSelection: { memberIds: [], groupIds: [] } })

      // Invalidate the inbox query to refresh data
      utils.inbox.getById.invalidate({ inboxId: inbox.id })
    },
    onError: (error) => {
      // If error occurs, revert the local state
      setAllowAllMembers(inbox.allowAllMembers)
      setIsUpdating(false)
      toastError({ title: 'Error updating access', description: error.message })
    },
  })

  // Prepare access items for rendering
  const accessItems: AccessItem[] = [
    ...inbox.memberAccess.map((access) => {
      const member = members.find((m) => m.id === access.organizationMemberId)
      return {
        id: access.organizationMemberId,
        type: 'member',
        name: member?.name || access.organizationMemberId.substring(0, 8),
      }
    }),
    ...inbox.groupAccess.map((access) => {
      const group = groups.find((g) => g.id === access.groupId)
      const memberCount = group?.members ? group.members.length : 0
      return {
        id: access.groupId,
        type: 'group',
        name: group?.name || access.groupId.substring(0, 8),
        memberCount,
      }
    }),
  ]

  // Handle allow all members toggle with optimistic update
  const handleAllowAllMembersChange = (checked: boolean) => {
    setIsUpdating(true)
    // Update local state immediately for better UX
    setAllowAllMembers(checked)

    updateAccess.mutate({ inboxId: inbox.id, allowAllMembers: checked })
  }

  // Handle removing a member or group from access with confirmation
  const handleRemoveAccess = async (item: AccessItem) => {
    const confirmed = await confirm({
      title: `Remove ${item.type} access?`,
      description: `This will remove ${item.name}'s access to the inbox.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      setIsUpdating(true)

      if (item.type === 'member') {
        // Remove member
        const currentMemberIds = inbox.memberAccess.map((m) => m.organizationMemberId)
        const updatedMemberIds = currentMemberIds.filter((id) => id !== item.id)
        updateAccess.mutate({ inboxId: inbox.id, memberIds: updatedMemberIds })
      } else {
        // Remove group
        const currentGroupIds = inbox.groupAccess.map((g) => g.groupId)
        const updatedGroupIds = currentGroupIds.filter((id) => id !== item.id)
        updateAccess.mutate({ inboxId: inbox.id, groupIds: updatedGroupIds })
      }
    }
  }

  // Handle adding selected members and groups
  const onSubmit = (data: {
    memberGroupSelection: { memberIds: string[]; groupIds: string[] }
  }) => {
    if (
      data.memberGroupSelection.memberIds.length === 0 &&
      data.memberGroupSelection.groupIds.length === 0
    ) {
      toastError({
        title: 'No selection',
        description: 'Please select at least one member or group to add',
      })
      return
    }

    setIsUpdating(true)

    // Get current member and group IDs
    const currentMemberIds = inbox.memberAccess.map((m) => m.organizationMemberId)
    const currentGroupIds = inbox.groupAccess.map((g) => g.groupId)

    // Combine current IDs with new selections (no duplicates)
    const updatedMemberIds = [
      ...new Set([...currentMemberIds, ...data.memberGroupSelection.memberIds]),
    ]
    const updatedGroupIds = [
      ...new Set([...currentGroupIds, ...data.memberGroupSelection.groupIds]),
    ]

    updateAccess.mutate({
      inboxId: inbox.id,
      memberIds: updatedMemberIds,
      groupIds: updatedGroupIds,
    })
  }

  // Get avatar fallback for member or group
  const getAvatarFallback = (item: AccessItem) => {
    if (item.type === 'member') {
      return item.name.charAt(0).toUpperCase()
    }
    return <UsersIcon className="h-4 w-4" />
  }

  // Use local state for rendering decisions instead of inbox.allowAllMembers
  // This ensures the UI updates immediately when the switch is toggled
  const showRestrictedAccess = !allowAllMembers

  return (
    <div className="p-6 space-y-6">
      {/* Render the confirmation dialog */}
      <ConfirmDialog />

      <div className="flex items-center space-x-2">
        <Switch
          id="allowAllMembers"
          checked={allowAllMembers}
          onCheckedChange={handleAllowAllMembersChange}
          disabled={isUpdating}
        />
        <Label htmlFor="allowAllMembers">Allow all organization members to access this inbox</Label>
      </div>

      {showRestrictedAccess && (
        <div className="space-y-6">
          <div>
            <h3 className="mb-4 text-lg font-medium">Access Management</h3>

            {/* Combined Access Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-32 text-right">Members</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accessItems.length > 0 ? (
                  accessItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="flex items-center space-x-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>{getAvatarFallback(item)}</AvatarFallback>
                        </Avatar>
                        <span>{item.name}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.type === 'group' ? `${item.memberCount} members` : '--'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isUpdating}
                          onClick={() => handleRemoveAccess(item)}>
                          <X className="h-4 w-4" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-muted-foreground">
                      No members or groups have been added. Add access to grant permissions.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add members/groups form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <MemberGroupFormField
                name="memberGroupSelection"
                control={form.control}
                label="Select members or groups to add"
                disabled={isUpdating}
              />
              <Button type="submit" disabled={isUpdating} className="mt-2">
                {isUpdating ? 'Adding...' : 'Add Selected'}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  )
}
