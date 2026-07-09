// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-bulk-bar.tsx
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
import { getKnowledgeBaseStoreState } from '../../store/knowledge-base-store'
import { useKnowledgeBasesList } from './knowledge-bases-provider'

/**
 * Floating bulk-action bar for the knowledge bases grid — currently just
 * delete. Uses the raw `kb.delete` mutation (not `useKnowledgeBaseMutations`)
 * so `useBulkRunner` can detect per-item failures via thrown rejections —
 * `deleteKnowledgeBase()` swallows errors and always resolves, which would
 * make every failure count as a success. The Zustand KB store (read by
 * kb-switcher.tsx) is synced manually on each success instead.
 */
export function KnowledgeBasesBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((s) => s.exit)
  const { refetch } = useKnowledgeBasesList()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()
  const del = api.kb.delete.useMutation()

  const actions: ActionBarAction[] = [
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      variant: 'destructive',
      tooltip: 'Delete selected',
      disabled: isRunning || count === 0,
      onClick: () =>
        run(
          ids,
          async (id) => {
            await del.mutateAsync({ id })
            getKnowledgeBaseStoreState().confirmKBDelete(id)
          },
          {
            title: `Delete ${count} ${pluralize(count, 'knowledge base')}?`,
            description: 'This permanently deletes them. This cannot be undone.',
            failureTitle: 'Some knowledge bases could not be deleted',
            onDone: () => {
              refetch()
              exit()
            },
          }
        ),
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
