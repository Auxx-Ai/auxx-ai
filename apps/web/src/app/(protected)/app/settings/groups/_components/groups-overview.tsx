'use client'
// /app/(protected)/app/settings/groups/_components/groups-overview.tsx
import { useState } from 'react'
import { GroupsList } from './groups-list'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { GroupDetailDialog } from './group-detail-dialog'
import { api } from '~/trpc/react'
import { toast } from 'sonner'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { useUser } from '~/hooks/use-user'
import { useConfirm } from '~/hooks/use-confirm'

export function GroupsOverview() {
  const [confirm, ConfirmDialog] = useConfirm()
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  const utils = api.useUtils()

  const deleteGroup = api.group.delete.useMutation({
    onSuccess: () => {
      toast.success('Group deleted successfully')
      utils.group.all.invalidate()
    },
    onError: (error) => {
      toast.error(`Error deleting group: ${error.message}`)
    },
  })

  /** Opens the create group dialog */
  const handleCreateGroup = () => {
    setIsCreateDialogOpen(true)
  }

  /** Opens the edit group dialog */
  const handleEditGroup = (groupId: string) => {
    setSelectedGroupId(groupId)
    setIsEditDialogOpen(true)
  }

  /** Prompts for confirmation and deletes the group */
  const handleDeleteGroup = async (groupId: string) => {
    const confirmed = await confirm({
      title: 'Delete group?',
      description:
        'This action cannot be undone. This will permanently delete the group and remove all members from it.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteGroup.mutate({ id: groupId })
    }
  }

  /** Opens the edit dialog when a group is selected */
  const handleGroupSelect = (groupId: string) => {
    setSelectedGroupId(groupId)
    setIsEditDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* <div className='flex items-center justify-between'>
        <h2 className='text-3xl font-bold tracking-tight'>Groups</h2>
        <Button onClick={handleCreateGroup}>
          <Plus className='mr-2 h-4 w-4' /> Add Group
        </Button>
      </div> */}

      <GroupsList
        onGroupSelect={handleGroupSelect}
        onEditGroup={handleEditGroup}
        onCreateGroup={handleCreateGroup}
        onDeleteGroup={handleDeleteGroup}
        selectedGroupId={selectedGroupId || undefined}
      />

      {/* Create Group Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent position="tc" size="md">
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <GroupDetailDialog
            mode="create"
            onCancel={() => setIsCreateDialogOpen(false)}
            onSuccess={() => {
              setIsCreateDialogOpen(false)
              utils.group.all.invalidate()
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" position="tc" size="md">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          {selectedGroupId && (
            <GroupDetailDialog
              mode="edit"
              groupId={selectedGroupId}
              onCancel={() => setIsEditDialogOpen(false)}
              onSuccess={() => {
                setIsEditDialogOpen(false)
                utils.group.all.invalidate()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}
