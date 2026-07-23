// apps/web/src/components/groups/ui/groups-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Trash } from 'lucide-react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useGroupMutations } from '../hooks'

/** Floating bulk-action bar for the Groups tab — bulk delete. */
export function GroupsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const { deleteGroup } = useGroupMutations()

  const actions: ActionBarAction[] = [
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      variant: 'destructive',
      tooltip: 'Delete selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (groupId) => deleteGroup.mutateAsync({ groupId }), {
          title: `Delete ${count} group${count === 1 ? '' : 's'}?`,
          description:
            'This permanently deletes the selected groups and removes all members from them. This cannot be undone.',
          failureTitle: 'Some groups could not be deleted',
          onDone: exit,
        }),
    },
  ]

  return (
    <>
      <ConfirmDialog />
      <ActionBar
        open={bulkMode || count > 0}
        onOpenChange={(open) => !open && exit()}
        selectedCount={count}
        selectedLabel='selected'
        actions={actions}
        showClose
      />
    </>
  )
}
