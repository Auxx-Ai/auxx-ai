// apps/web/src/components/groups/ui/groups-tab.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ListSelectionProvider, useBulkMode, useListSelection } from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { useGroupMutations, useGroups } from '../hooks'
import { GroupCard } from './group-card'
import { GroupDetailDialog } from './group-detail-dialog'
import { GroupsBulkBar } from './groups-bulk-bar'

interface GroupsTabProps {
  /** Controlled create-dialog state — driven by the page's "Create Group" header button. */
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
}

/** Groups tab body — searchable group list with bulk delete + create/edit dialogs. */
export function GroupsTab({ createOpen, onCreateOpenChange }: GroupsTabProps) {
  return (
    <ListSelectionProvider>
      <GroupsTabInner createOpen={createOpen} onCreateOpenChange={onCreateOpenChange} />
    </ListSelectionProvider>
  )
}

function GroupsTabInner({ createOpen, onCreateOpenChange }: GroupsTabProps) {
  const { data: groups, isLoading } = useGroups()
  const { deleteGroup } = useGroupMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  const [search, setSearch] = useState('')
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)
  const setItemIds = useListSelection((s) => s.setItemIds)

  const filteredGroups = useMemo(() => {
    const list = groups ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((g) => g.displayName?.toLowerCase().includes(q))
  }, [groups, search])

  // Keep the selection store's visible-id set in sync so bulk select/all works.
  useEffect(() => {
    setItemIds(filteredGroups.map((g) => g.id))
  }, [filteredGroups, setItemIds])

  const handleEdit = (groupId: string) => {
    setSelectedGroupId(groupId)
    setIsEditDialogOpen(true)
  }

  const handleDelete = async (groupId: string) => {
    const confirmed = await confirm({
      title: 'Delete group?',
      description:
        'This action cannot be undone. This will permanently delete the group and remove all members from it.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
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

  return (
    <div className='flex flex-1 flex-col'>
      <ListToolbar sticky={false}>
        <InputSearch
          value={search}
          placeholder='Search groups...'
          onChange={(e) => setSearch(e.target.value)}
        />
        <ListToolbarGroup align='end'>
          <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />
        </ListToolbarGroup>
      </ListToolbar>

      <div className='p-3 sm:p-6'>
        {isLoading ? (
          <div className='space-y-2'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='flex items-center gap-3 rounded-2xl border p-3'>
                <Skeleton className='size-8 shrink-0 rounded-xl' />
                <div className='flex flex-1 flex-col gap-1'>
                  <Skeleton className='h-4 w-40' />
                  <Skeleton className='h-3 w-24' />
                </div>
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center py-8'>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No groups found</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? 'Try adjusting your search terms'
                    : 'Create your first group to organize your team'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className='space-y-2'>
            {filteredGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onSelect={handleEdit}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <GroupsBulkBar />
      <ConfirmDialog />

      {/* Create group */}
      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent position='tc' size='md'>
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <GroupDetailDialog
            mode='create'
            onCancel={() => onCreateOpenChange(false)}
            onSuccess={() => onCreateOpenChange(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit group */}
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
    </div>
  )
}
