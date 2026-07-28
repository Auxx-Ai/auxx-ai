// apps/web/src/components/dashboard/ui/dashboards-bulk-bar.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
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
import { useAccess } from '~/providers/capabilities-provider'
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
  const { canAdminInstance } = useAccess()

  // Delete is Full-only per instance — hide the bulk action unless every
  // selected dashboard passes admin (doc 24 §A.2.6; per-item filtering inside a
  // bulk delete is silent-partial-failure UX).
  const allSelectedAdmin = ids.every((id) => canAdminInstance(toRecordId('dashboard', id)))

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
