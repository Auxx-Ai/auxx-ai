// apps/web/src/components/inbox/inbox-access-tab.tsx
'use client'

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { Inbox } from '@auxx/lib/inboxes'
import { type ActorId, parseActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { Form } from '@auxx/ui/components/form'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { ActorFormField } from '~/components/pickers/actor-picker'
import { useResourceAccess } from '~/components/resources/hooks'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** Form data shape */
interface FormData {
  actorIds: ActorId[]
}

/** Tab component for managing inbox access permissions */
export function InboxAccessTab({ inbox }: { inbox: Inbox }) {
  // Track local visibility state for immediate UI updates
  const [visibility, setVisibility] = useState(inbox.visibility)
  const [isUpdating, setIsUpdating] = useState(false)

  // Use the confirm hook for confirmation dialogs
  const [confirm, ConfirmDialog] = useConfirm()

  // Get utils for invalidating queries
  const utils = api.useUtils()

  // Form setup
  const form = useForm<FormData>({ defaultValues: { actorIds: [] } })

  // RecordId for resource access (inbox:{id} format)
  const recordId = inbox.recordId

  // Get all access grants from ResourceAccess system
  const { granteeActorIds, isLoading: isLoadingAccess } = useResourceAccess({
    recordId,
    enabled: visibility !== 'org_members',
  })

  // Update inbox access mutation
  const updateAccess = api.inbox.updateAccess.useMutation({
    onSuccess: () => {
      setIsUpdating(false)
      form.reset({ actorIds: [] })
      utils.inbox.getById.invalidate({ inboxId: inbox.id })
      utils.resourceAccess.forInstance.invalidate({ recordId })
    },
    onError: (error) => {
      setVisibility(inbox.visibility)
      setIsUpdating(false)
      toastError({ title: 'Error updating access', description: error.message })
    },
  })

  // Grant resource access
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

  // Revoke resource access
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

  /** Handle visibility toggle with optimistic update */
  const handleVisibilityChange = (allowAll: boolean) => {
    setIsUpdating(true)
    const newVisibility = allowAll ? 'org_members' : 'custom'
    setVisibility(newVisibility)
    updateAccess.mutate({
      inboxId: inbox.id,
      visibility: newVisibility,
    })
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

    // Both users and groups now use ResourceAccess
    const granteeType = type === 'user' ? ResourceGranteeType.user : ResourceGranteeType.group
    revokeAccess.mutate({
      recordId,
      granteeType,
      granteeId: id,
    })
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

    // Grant access to each actor via ResourceAccess
    for (const actorId of data.actorIds) {
      const { type, id } = parseActorId(actorId)
      const granteeType = type === 'user' ? ResourceGranteeType.user : ResourceGranteeType.group

      grantAccess.mutate({
        recordId,
        granteeType,
        granteeId: id,
        permission: ResourcePermission.view,
      })
    }

    form.reset({ actorIds: [] })
  }

  // Show restricted access UI when not allowing all members
  const showRestrictedAccess = visibility !== 'org_members'

  return (
    <div className='p-6 space-y-6'>
      {/* Render the confirmation dialog */}
      <ConfirmDialog />

      <div className='flex items-center space-x-2'>
        <Switch
          id='allowAllMembers'
          checked={visibility === 'org_members'}
          onCheckedChange={handleVisibilityChange}
          disabled={isUpdating}
        />
        <Label htmlFor='allowAllMembers'>Allow all organization members to access this inbox</Label>
      </div>

      {showRestrictedAccess && (
        <div className='space-y-6'>
          <div>
            <h3 className='mb-4 text-lg font-medium'>Access Management</h3>

            {/* Combined Access Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className='w-20'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {granteeActorIds.length > 0 ? (
                  granteeActorIds.map((actorId) => (
                    <TableRow key={actorId}>
                      <TableCell>
                        <ActorBadge actorId={actorId} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant='ghost'
                          size='icon'
                          disabled={isUpdating}
                          onClick={() => handleRemoveAccess(actorId)}>
                          <X className='h-4 w-4' />
                          <span className='sr-only'>Remove</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className='py-4 text-center text-muted-foreground'>
                      {isLoadingAccess
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
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              <ActorFormField
                name='actorIds'
                control={form.control}
                label='Select members or groups to add'
                target='both'
                placeholder='Add members or groups'
                disabled={isUpdating}
              />
              <Button
                type='submit'
                disabled={isUpdating}
                loading={isUpdating}
                loadingText='Adding...'>
                Add Selected
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  )
}
