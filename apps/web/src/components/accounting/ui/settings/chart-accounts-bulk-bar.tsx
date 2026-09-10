// apps/web/src/components/accounting/ui/settings/chart-accounts-bulk-bar.tsx
'use client'

// The floating bulk bar for the Chart of accounts tab: remove a set of accounts,
// or put a set of removed ones back.
//
// 🛑 TWO actions over ONE selection, each acting on the SUBSET it applies to.
// A chart list showing archived rows can hold a mixed selection, and the honest
// answer is not to forbid that - it is for Remove to name how many of the picked
// rows are actually removable and Restore to name how many are actually
// restorable. Disabling both on any mixed selection would make "select all,
// clean up" impossible, which is the one thing a bulk bar is for.
//
// 🛑 Every refusal is the SERVER's. `removeChartAccount` refuses while a live
// role still posts to an account, naming the role; `useBulkRunner` counts the
// failures and says how many of how many. A client-side pre-check of that rule
// would be a second authority over where money lands.

import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { api } from '~/trpc/react'

export function ChartAccountsBulkBar() {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((state) => state.exit)
  const utils = api.useUtils()
  const { ConfirmDialog, run, isRunning } = useBulkRunner()

  // The same query key the page holds, so this is the cache and not a refetch.
  const chart = api.ledger.chartAccounts.useQuery({ includeArchived: true })

  const removeAccount = api.ledger.chartAccountRemove.useMutation()
  const restoreAccount = api.ledger.chartAccountRestore.useMutation()

  const { live, archived } = useMemo(() => {
    const byId = new Map((chart.data ?? []).map((account) => [account.id, account]))
    const live: string[] = []
    const archived: string[] = []
    for (const id of ids) {
      const account = byId.get(id)
      if (!account) continue
      if (account.isArchived) archived.push(id)
      else live.push(id)
    }
    return { live, archived }
  }, [ids, chart.data])

  const invalidate = () => {
    void utils.ledger.chartAccounts.invalidate()
    void utils.ledger.roleMap.invalidate()
    void utils.ledger.accountMap.invalidate()
  }

  const handleRemove = () =>
    run(live, (id) => removeAccount.mutateAsync({ id }), {
      title: `Remove ${live.length} account${live.length === 1 ? '' : 's'}?`,
      description:
        'They come out of the chart. Entries already posted keep the code and the name they were written with, and you can put them back from Show archived.',
      confirmText: 'Remove',
      failureTitle: 'Some accounts could not be removed',
      pendingLabel: 'Removing…',
      onDone: () => {
        invalidate()
        exit()
      },
    })

  const handleRestore = () =>
    run(archived, (id) => restoreAccount.mutateAsync({ id }), {
      title: `Put ${archived.length} account${archived.length === 1 ? '' : 's'} back?`,
      description:
        'They return to the chart with their code, their name and their link to the accounting system. No posting role is re-pointed at them.',
      confirmText: 'Restore',
      destructive: false,
      // The row STAYS - it is only un-dimmed - so the pending marker has to be
      // cleared on settle rather than left for a refetch to remove the row.
      removesItem: false,
      failureTitle: 'Some accounts could not be restored',
      pendingLabel: 'Restoring…',
      onDone: () => {
        invalidate()
        exit()
      },
    })

  const actions: ActionBarAction[] = [
    {
      id: 'restore',
      label: archived.length === count ? 'Restore' : `Restore ${archived.length}`,
      icon: RotateCcw,
      variant: 'outline',
      tooltip: 'Put the removed accounts back in the chart',
      // Hidden rather than disabled when nothing in the selection is archived:
      // most selections are all-live, and a permanently dead Restore button
      // beside Remove is one more thing to read past.
      hidden: archived.length === 0,
      disabled: isRunning,
      onClick: () => void handleRestore(),
    },
    {
      id: 'remove',
      label: live.length === count ? 'Remove' : `Remove ${live.length}`,
      icon: Trash2,
      variant: 'destructive',
      tooltip: 'Take the selected accounts out of the chart',
      hidden: live.length === 0,
      disabled: isRunning,
      onClick: () => void handleRemove(),
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
