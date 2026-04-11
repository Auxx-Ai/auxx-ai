// apps/web/src/app/(protected)/app/settings/groups/page.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Folder } from 'lucide-react'
import { useState } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { GroupDetailDialog, GroupsList, useGroupMutations, useGroups } from '~/components/groups'
import { useConfirm } from '~/hooks/use-confirm'

/**
 * Groups settings page
 * Manages organization groups using the new EntityGroup system
 */
export default function GroupsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: groups, isLoading } = useGroups()
  const { deleteGroup } = useGroupMutations()

  /** Opens the create group dialog */
  const handleCreateGroup = () => {
    setIsCreateDialogOpen(true)
  }

  /** Opens the edit group dialog */
  const handleEditGroup = (groupId: string) => {
    setSelectedGroupId(groupId)
    setIsEditDialogOpen(true)
  }

  /** Opens the edit dialog when a group is selected */
  const handleGroupSelect = (groupId: string) => {
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
      try {
        await deleteGroup.mutateAsync({ groupId })
        toastSuccess({ title: 'Group deleted successfully' })
      } catch (error) {
        toastError({
          title: 'Error deleting group',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  return (
    <SettingsPage
      icon={<Folder />}
      title='Member groups'
      description='View and edit your workgroup members'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Groups' }]}>
      <div className='p-3 sm:p-6 flex-col flex flex-1 min-h-0'>
        <GroupsList
          groups={groups ?? []}
          isLoading={isLoading}
          onSelect={handleGroupSelect}
          onEdit={handleEditGroup}
          onCreate={handleCreateGroup}
          onDelete={handleDeleteGroup}
        />

        {/* Create Group Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent position='tc' size='md'>
            <DialogHeader>
              <DialogTitle>Create Group</DialogTitle>
            </DialogHeader>
            <GroupDetailDialog
              mode='create'
              onCancel={() => setIsCreateDialogOpen(false)}
              onSuccess={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>

        {/* Edit Group Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className='max-h-[90vh] overflow-y-auto' position='tc' size='md'>
            <DialogHeader>
              <DialogTitle>Edit Group</DialogTitle>
            </DialogHeader>
            {selectedGroupId && (
              <GroupDetailDialog
                mode='edit'
                groupId={selectedGroupId}
                onCancel={() => setIsEditDialogOpen(false)}
                onSuccess={() => setIsEditDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog />
      </div>
    </SettingsPage>
  )
}
