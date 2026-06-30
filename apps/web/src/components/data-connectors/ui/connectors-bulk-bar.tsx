// apps/web/src/components/data-connectors/ui/connectors-bulk-bar.tsx
'use client'

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Trash } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { api } from '~/trpc/react'

type Disposition = 'keep' | 'archive' | 'delete'

/**
 * Dropdown trigger used by the ActionBar `picker` slot — the Delete button opens
 * a synced-records disposition menu (keep / archive / delete), mirroring the
 * connector card's delete submenu. The single bulk action never overflows, so
 * only the children-as-trigger path is needed.
 */
function ConnectorDeleteMenu({
  children,
  onSelect,
}: {
  children?: ReactNode
  onSelect?: (disposition: Disposition) => void
}) {
  if (!children) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={() => onSelect?.('keep')}>
          Delete, keep synced records
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect?.('archive')}>
          Delete, archive synced records
        </DropdownMenuItem>
        <DropdownMenuItem variant='destructive' onSelect={() => onSelect?.('delete')}>
          Delete connectors and synced records
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DISPOSITION_COPY: Record<Disposition, string> = {
  keep: 'The connectors are removed; their synced records are kept.',
  archive: 'The connectors are removed and their synced records are archived.',
  delete: 'The connectors and all their synced records are permanently deleted.',
}

/** Floating bulk-action bar for the connectors grid — delete with a disposition. */
export function ConnectorsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const utils = api.useUtils()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const deleteConnector = api.dataConnector.delete.useMutation()

  const handleDelete = (syncedData: Disposition) =>
    run(ids, (id) => deleteConnector.mutateAsync({ id, syncedData }), {
      title: `Delete ${count} connector${count === 1 ? '' : 's'}?`,
      description: `${DISPOSITION_COPY[syncedData]} This cannot be undone.`,
      failureTitle: 'Some connectors could not be deleted',
      onDone: () => {
        void utils.dataConnector.list.invalidate()
        exit()
      },
    })

  const actions: ActionBarAction[] = [
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      variant: 'destructive',
      tooltip: 'Delete selected',
      disabled: isRunning || count === 0,
      picker: {
        component: ConnectorDeleteMenu,
        props: { onSelect: handleDelete },
      },
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
