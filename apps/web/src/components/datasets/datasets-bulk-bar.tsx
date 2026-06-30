// apps/web/src/components/datasets/datasets-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Archive, Trash } from 'lucide-react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { api } from '~/trpc/react'
import { useDatasets } from './datasets-provider'

/** Floating bulk-action bar for the datasets grid — archive + delete. */
export function DatasetsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const { refetch } = useDatasets()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const deleteDataset = api.dataset.delete.useMutation()
  const archiveDataset = api.dataset.archive.useMutation()

  const noun = (n: number) => `${n} dataset${n === 1 ? '' : 's'}`

  const actions: ActionBarAction[] = [
    {
      id: 'archive',
      label: 'Archive',
      icon: Archive,
      tooltip: 'Archive selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (id) => archiveDataset.mutateAsync({ id }), {
          title: `Archive ${noun(count)}?`,
          description: 'They will be hidden from the main view but can be restored later.',
          confirmText: 'Archive',
          destructive: false,
          pendingLabel: 'Archiving…',
          removesItem: false,
          failureTitle: 'Some datasets could not be archived',
          onDone: () => {
            refetch()
            exit()
          },
        }),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      variant: 'destructive',
      tooltip: 'Delete selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(ids, (id) => deleteDataset.mutateAsync({ id }), {
          title: `Delete ${noun(count)}?`,
          description:
            'This permanently removes them and all associated documents and data. This cannot be undone.',
          failureTitle: 'Some datasets could not be deleted',
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
