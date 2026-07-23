// apps/web/src/components/groups/ui/group-danger-section.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useGroupMutations } from '../hooks'

/** Destructive actions for a group — permanently delete it. */
export function GroupDangerSection({ group }: { group: EntityInstanceEntity }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const { deleteGroup } = useGroupMutations()

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${group.displayName || 'group'}?`,
      description:
        'This action cannot be undone. This will permanently delete the group and remove all members from it.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await deleteGroup.mutateAsync({ groupId: group.id })
      toastSuccess({ description: 'Group deleted' })
      router.push('/app/settings/members?t=groups')
    } catch (error) {
      toastError({ title: 'Error deleting group', description: (error as Error).message })
    }
  }

  return (
    <SettingsSection
      icon={TriangleAlert}
      title='Danger zone'
      description='Irreversible actions for this group'>
      <div className='flex items-center justify-between gap-4 rounded-2xl border border-destructive/30 p-4'>
        <div className='min-w-0'>
          <p className='text-sm font-medium'>Delete this group</p>
          <p className='text-sm text-muted-foreground'>
            Permanently delete the group and remove all of its members.
          </p>
        </div>
        <Button
          variant='destructive'
          onClick={handleDelete}
          loading={deleteGroup.isPending}
          loadingText='Deleting...'>
          Delete group
        </Button>
      </div>
      <ConfirmDialog />
    </SettingsSection>
  )
}
