// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-bulk-bar.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Trash } from 'lucide-react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useWorkflows } from '../providers/workflows-provider'

/** Floating bulk-action bar for the workflows grid — currently just delete. */
export function WorkflowsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const { refetchWorkflows } = useWorkflows()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const deleteWorkflow = api.workflow.delete.useMutation()
  const { canAdminInstance } = useAccess()

  // Delete is Full per instance — hide the bulk action unless EVERY selected
  // workflow passes admin (plan 24 §A.2.6; per-item filtering inside a bulk
  // delete is silent-partial-failure UX).
  const allSelectedAdmin = ids.every((id) => canAdminInstance(toRecordId('workflow', id)))

  const actions: ActionBarAction[] = allSelectedAdmin
    ? [
        {
          id: 'delete',
          label: 'Delete',
          icon: Trash,
          variant: 'destructive',
          tooltip: 'Delete selected',
          disabled: isRunning || count === 0,
          onClick: () =>
            run(ids, (id) => deleteWorkflow.mutateAsync({ id }), {
              title: `Delete ${count} workflow${count === 1 ? '' : 's'}?`,
              description:
                'This permanently deletes them and all their execution history. This cannot be undone.',
              failureTitle: 'Some workflows could not be deleted',
              onDone: () => {
                refetchWorkflows()
                exit()
              },
            }),
        },
      ]
    : []

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
