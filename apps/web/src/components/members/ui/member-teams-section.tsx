// apps/web/src/components/members/ui/member-teams-section.tsx
'use client'

import { MemberType } from '@auxx/lib/groups/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { getGroupMetadata, useGroupMutations, useGroupsForUser } from '~/components/groups'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { Member } from '../types'

/** Teams (groups) a member belongs to, with add + remove. */
export function MemberTeamsSection({ member }: { member: Member }) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: groups, isLoading } = useGroupsForUser(member.userId)
  const { addMembers, removeMembers } = useGroupMutations()

  const memberGroupIds = useMemo(() => (groups ?? []).map((g) => g.id), [groups])
  // Hide teams the member already belongs to from the picker (group ActorIds).
  const excludeActorIds = useMemo<ActorId[]>(
    () => memberGroupIds.map((id) => toActorId('group', id)),
    [memberGroupIds]
  )

  const invalidate = () => utils.entityGroup.forUser.invalidate({ userId: member.userId })

  const handleAdd = async (groupId: string) => {
    try {
      await addMembers.mutateAsync({
        groupId,
        members: [{ type: MemberType.user, id: member.userId }],
      })
      invalidate()
    } catch (error) {
      toastError({ title: 'Error adding to team', description: (error as Error).message })
    }
  }

  const handleRemove = async (groupId: string, groupName: string) => {
    const confirmed = await confirm({
      title: `Remove from ${groupName}?`,
      description: 'This member will lose any access granted through this team.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await removeMembers.mutateAsync({
        groupId,
        members: [{ type: MemberType.user, id: member.userId }],
      })
      invalidate()
    } catch (error) {
      toastError({ title: 'Error removing from team', description: (error as Error).message })
    }
  }

  const isEmpty = !isLoading && (groups ?? []).length === 0

  return (
    <SettingsSection
      icon={UsersRound}
      title='Teams'
      description='Teams this member belongs to'
      action={
        // Reuse the shared ActorPicker in group mode. Add-only: controlled value
        // stays empty, so each pick is an add; group ActorIds are `group:<id>`, so
        // unwrap to the raw id for entityGroup. Already-joined teams are excluded.
        <ActorPicker
          target='group'
          value={[]}
          onChange={(ids) => ids.forEach((actorId) => handleAdd(getActorRawId(actorId)))}
          excludeIds={excludeActorIds}
          placeholder='Search teams...'>
          <Button variant='outline' size='sm' disabled={addMembers.isPending}>
            <Plus />
            Add to team
          </Button>
        </ActorPicker>
      }>
      {isEmpty ? (
        <EmptySection
          icon={<UsersRound />}
          title='Not a member of any team yet'
          description='Add this member to a team to grant shared access.'
        />
      ) : (
        <div className='border p-1 rounded-xl'>
          <TreeRowList
            className='gap-1'
            items={groups ?? []}
            loading={isLoading}
            skeletonCount={2}
            getKey={(g) => g.id}
            renderRow={(g) => {
              const meta = getGroupMetadata(g)
              return (
                <TreeRow
                  rowClassName='bg-primary-50 hover:bg-primary-100 '
                  onDrill={() => router.push(`/app/settings/groups/${g.id}`)}
                  icon={<span className='text-sm'>{meta.icon || '👥'}</span>}
                  title={g.displayName}
                  secondary={meta.visibility === 'private' ? 'Private' : undefined}
                  actions={
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Remove from team'
                      onClick={() => handleRemove(g.id, g.displayName ?? 'this team')}>
                      <Trash2 />
                    </TreeRowButton>
                  }
                />
              )
            }}
          />
        </div>
      )}
      <ConfirmDialog />
    </SettingsSection>
  )
}
