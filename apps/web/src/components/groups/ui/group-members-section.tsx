// apps/web/src/components/groups/ui/group-members-section.tsx
'use client'

import { MemberType } from '@auxx/lib/groups/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { useMemo } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useGroupMembers, useGroupMutations } from '../hooks'
import { getInitials } from '../utils'

/** User members of a group, with add (ActorPicker) + per-row remove. */
export function GroupMembersSection({ groupId }: { groupId: string }) {
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: members, isLoading } = useGroupMembers(groupId)
  const { addMembers, removeMembers } = useGroupMutations()

  // Only user members are managed here (records are out of scope for this view).
  const userMembers = useMemo(
    () => (members ?? []).filter((m) => m.memberType === MemberType.user && m.user),
    [members]
  )

  // Hide already-added users from the picker (user ActorIds).
  const excludeActorIds = useMemo<ActorId[]>(
    () => userMembers.map((m) => toActorId('user', m.memberRefId)),
    [userMembers]
  )

  const handleAdd = async (userId: string) => {
    try {
      await addMembers.mutateAsync({
        groupId,
        members: [{ type: MemberType.user, id: userId }],
      })
    } catch (error) {
      toastError({ title: 'Error adding member', description: (error as Error).message })
    }
  }

  const handleRemove = async (userId: string, name: string) => {
    const confirmed = await confirm({
      title: `Remove ${name}?`,
      description: 'They will lose any access granted through this group.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await removeMembers.mutateAsync({
        groupId,
        members: [{ type: MemberType.user, id: userId }],
      })
    } catch (error) {
      toastError({ title: 'Error removing member', description: (error as Error).message })
    }
  }

  const isEmpty = !isLoading && userMembers.length === 0

  return (
    <SettingsSection
      icon={UsersRound}
      title='Members'
      description='People in this group'
      action={
        // Add-only ActorPicker in user mode: controlled value stays empty so each pick is
        // an add; user ActorIds are `user:<id>`, so unwrap to the raw id for entityGroup.
        <ActorPicker
          target='user'
          value={[]}
          onChange={(ids) => ids.forEach((actorId) => handleAdd(getActorRawId(actorId)))}
          excludeIds={excludeActorIds}
          placeholder='Search people...'>
          <Button variant='outline' size='sm' disabled={addMembers.isPending}>
            <Plus />
            Add member
          </Button>
        </ActorPicker>
      }>
      {isEmpty ? (
        <EmptySection
          icon={<UsersRound />}
          title='No members yet'
          description='Add people to grant them this group’s access.'
        />
      ) : (
        <div className='border p-1 rounded-xl'>
          <TreeRowList
            className='gap-1'
            items={userMembers}
            loading={isLoading}
            skeletonCount={2}
            getKey={(m) => m.id}
            renderRow={(m) => (
              <TreeRow
                rowClassName='bg-primary-50 hover:bg-primary-100'
                icon={
                  <Avatar className='size-6'>
                    <AvatarImage src={m.user?.image || undefined} alt={m.user?.name || ''} />
                    <AvatarFallback className='text-xs'>
                      {getInitials(m.user?.name || m.user?.email || 'U')}
                    </AvatarFallback>
                  </Avatar>
                }
                title={m.user?.name || 'Unnamed User'}
                secondary={m.user?.email || undefined}
                actions={
                  <TreeRowButton
                    variant='destructive'
                    tooltipText='Remove from group'
                    onClick={() => handleRemove(m.memberRefId, m.user?.name || 'this member')}>
                    <Trash2 />
                  </TreeRowButton>
                }
              />
            )}
          />
        </div>
      )}
      <ConfirmDialog />
    </SettingsSection>
  )
}
