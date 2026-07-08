// apps/web/src/components/dashboard/ui/dashboards-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { pluralize } from '@auxx/utils/strings'
import { Trash } from 'lucide-react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { api } from '~/trpc/react'
import { useDashboards } from './dashboards-provider'

/** Floating bulk-action bar for the dashboards grid — currently just delete. */
export function DashboardsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const { refetch } = useDashboards()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const del = api.dashboard.delete.useMutation()

  const actions: ActionBarAction[] = [
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      variant: 'destructive',
      tooltip: 'Delete selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (id) => del.mutateAsync({ id }), {
          title: `Delete ${count} ${pluralize(count, 'dashboard')}?`,
          description: 'This permanently deletes them. This cannot be undone.',
          failureTitle: 'Some dashboards could not be deleted',
          onDone: () => {
            refetch()
            exit()
          },
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
