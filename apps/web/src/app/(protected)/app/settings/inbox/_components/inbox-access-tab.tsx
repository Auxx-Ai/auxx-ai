// /app/settings/inbox/_components/inbox-access-tab.tsx
'use client'

import { useState, useMemo } from 'react'
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
import { X } from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { InboxWithRelations } from '@auxx/lib/types'
import { useResourceAccess } from '~/components/resources/hooks'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { ActorFormField } from '~/components/pickers/actor-picker'
import { toActorId, parseActorId, type ActorId } from '@auxx/types/actor'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'

/** Form data shape */
interface FormData {
  actorIds: ActorId[]
}

export function InboxAccessTab({ inbox }: { inbox: InboxWithRelations }) {
  // Track local state of allowAllMembers to ensure immediate UI updates
  const [allowAllMembers, setAllowAllMembers] = useState(inbox.allowAllMembers)
  const [isUpdating, setIsUpdating] = useState(false)

  // Use the confirm hook for confirmation dialogs
  const [confirm, ConfirmDialog] = useConfirm()

  // Get utils for invalidating queries
  const utils = api.useUtils()

  // Form setup
  const form = useForm<FormData>({ defaultValues: { actorIds: [] } })

  // RecordId for resource access (inbox:{id} format)
  const recordId = `inbox:${inbox.id}`

  // Get group access from ResourceAccess system
  const { granteeActorIds: groupActorIds, isLoading: isLoadingGroups } = useResourceAccess({
    recordId,
    enabled: !allowAllMembers,
  })

  // Convert member access to ActorIds
  const memberActorIds = useMemo(
    () => inbox.memberAccess.map((m) => toActorId('user', m.organizationMemberId)),
    [inbox.memberAccess]
  )

  // Combine all access into single array of ActorIds
  const allActorIds = useMemo(
    () => [...memberActorIds, ...groupActorIds],
    [memberActorIds, groupActorIds]
  )

  // Update inbox access mutation (for members and allowAllMembers toggle)
  const updateAccess = api.inbox.updateAccess.useMutation({
    onSuccess: () => {
      setIsUpdating(false)
      form.reset({ actorIds: [] })
      utils.inbox.getById.invalidate({ inboxId: inbox.id })
    },
    onError: (error) => {
      setAllowAllMembers(inbox.allowAllMembers)
      setIsUpdating(false)
      toastError({ title: 'Error updating access', description: error.message })
    },
  })

  // Grant resource access (for groups)
  const grantAccess = api.resourceAccess.grantInstance.useMutation({
    onSuccess: () => {
      setIsUpdating(false)
      form.reset({ actorIds: [] })
      utils.resourceAccess.forInstance.invalidate({ recordId })
    },
    onError: (error) => {
      setIsUpdating(false)
      toastError({ title: 'Error granting access', description: error.message })
    },
  })

  // Revoke resource access (for groups)
  const revokeAccess = api.resourceAccess.revokeInstance.useMutation({
    onSuccess: () => {
      setIsUpdating(false)
      utils.resourceAccess.forInstance.invalidate({ recordId })
    },
    onError: (error) => {
      setIsUpdating(false)
      toastError({ title: 'Error revoking access', description: error.message })
    },
  })

  /** Handle allow all members toggle with optimistic update */
  const handleAllowAllMembersChange = (checked: boolean) => {
    setIsUpdating(true)
    setAllowAllMembers(checked)
    updateAccess.mutate({ inboxId: inbox.id, allowAllMembers: checked })
  }

  /** Handle removing an actor from access with confirmation */
  const handleRemoveAccess = async (actorId: ActorId) => {
    const { type, id } = parseActorId(actorId)

    const confirmed = await confirm({
      title: `Remove ${type} access?`,
      description: `This will remove access to the inbox.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    setIsUpdating(true)

    if (type === 'user') {
      // Remove member from inbox.memberAccess
      const currentMemberIds = inbox.memberAccess.map((m) => m.organizationMemberId)
      const updatedMemberIds = currentMemberIds.filter((mid) => mid !== id)
      updateAccess.mutate({ inboxId: inbox.id, memberIds: updatedMemberIds })
    } else {
      // Remove group via ResourceAccess
      revokeAccess.mutate({
        recordId,
        granteeType: ResourceGranteeType.group,
        granteeId: id,
      })
    }
  }

  /** Handle adding selected actors */
  const onSubmit = (data: FormData) => {
    if (data.actorIds.length === 0) {
      toastError({
        title: 'No selection',
        description: 'Please select at least one member or group to add',
      })
      return
    }

    setIsUpdating(true)

    // Separate users and groups
    const newUserIds: string[] = []
    const newGroupIds: string[] = []

    for (const actorId of data.actorIds) {
      const { type, id } = parseActorId(actorId)
      if (type === 'user') {
        newUserIds.push(id)
      } else {
        newGroupIds.push(id)
      }
    }

    // Add users to member access (if any)
    if (newUserIds.length > 0) {
      const currentMemberIds = inbox.memberAccess.map((m) => m.organizationMemberId)
      const updatedMemberIds = [...new Set([...currentMemberIds, ...newUserIds])]
      updateAccess.mutate({ inboxId: inbox.id, memberIds: updatedMemberIds })
    }

    // Add groups via ResourceAccess (if any)
    for (const groupId of newGroupIds) {
      grantAccess.mutate({
        recordId,
        granteeType: ResourceGranteeType.group,
        granteeId: groupId,
        permission: ResourcePermission.view,
      })
    }

    // If only groups were added and no users, reset form here
    if (newUserIds.length === 0 && newGroupIds.length > 0) {
      form.reset({ actorIds: [] })
    }
  }

  // Use local state for rendering decisions
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
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allActorIds.length > 0 ? (
                  allActorIds.map((actorId) => (
                    <TableRow key={actorId}>
                      <TableCell>
                        <ActorBadge actorId={actorId} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isUpdating}
                          onClick={() => handleRemoveAccess(actorId)}>
                          <X className="h-4 w-4" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="py-4 text-center text-muted-foreground">
                      {isLoadingGroups
                        ? 'Loading...'
                        : 'No members or groups have been added. Add access to grant permissions.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add members/groups form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <ActorFormField
                name="actorIds"
                control={form.control}
                label="Select members or groups to add"
                target="both"
                placeholder="Add members or groups"
                disabled={isUpdating}
              />
              <Button type="submit" disabled={isUpdating} loading={isUpdating} loadingText="Adding...">
                Add Selected
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  )
}
