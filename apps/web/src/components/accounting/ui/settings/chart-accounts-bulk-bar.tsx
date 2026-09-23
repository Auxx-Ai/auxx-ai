// apps/web/src/components/accounting/ui/settings/chart-accounts-bulk-bar.tsx
'use client'

// The floating bulk bar for the Chart of accounts tab: remove a set of accounts,
// put a set of removed ones back, or create the unlinked ones in the connected
// accounting system and link them (97 item 10).
//
// 🛑 THREE actions over ONE selection, each acting on the SUBSET it applies to.
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

import { providerCreateOrder } from '@auxx/lib/accounting/providers/client'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { toastError } from '@auxx/ui/components/toast'
import { CloudUpload, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { api } from '~/trpc/react'
import { formatAccountLabel } from '../account-label-format'
import type { ChartMapView } from './accounts-types'

interface ChartAccountsBulkBarProps {
  /** The account map, for which rows are unlinked and whether the provider takes creates. */
  map: ChartMapView
  /** `PermissionKey.ledgerControl` - the same gate the per-row create wears. */
  canControl: boolean
}

export function ChartAccountsBulkBar({ map, canControl }: ChartAccountsBulkBarProps) {
  const ids = useSelectionIds()
  const count = useSelectionCount()
  const bulkMode = useBulkMode()
  const exit = useListSelection((state) => state.exit)
  const addPending = useListSelection((state) => state.addPending)
  const removePending = useListSelection((state) => state.removePending)
  const setPendingLabel = useListSelection((state) => state.setPendingLabel)
  const utils = api.useUtils()
  const { ConfirmDialog, confirm, run, isRunning } = useBulkRunner()
  const [creating, setCreating] = useState(false)
  const busy = isRunning || creating

  // The same query key the page holds, so this is the cache and not a refetch.
  const chart = api.ledger.chartAccounts.useQuery({ includeArchived: true })

  const removeAccount = api.ledger.chartAccountRemove.useMutation()
  const restoreAccount = api.ledger.chartAccountRestore.useMutation()
  const createInProvider = api.ledger.createProviderAccounts.useMutation()

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

  // The server decides the same way; this copy only previews the confirm and marks the rows.
  const creatable = useMemo(
    () => providerCreateOrder(chart.data ?? [], map.byAccountId, ids),
    [ids, chart.data, map.byAccountId]
  )
  const canCreate = canControl && map.connected && !map.isPending && map.canCreate
  const where = map.providerLabel ?? 'the connected accounting system'

  // ONE call: the server resolves the connection once, goes parents first and
  // halts on the first refusal, keeping what landed. The map is a provider
  // round trip, so it is refetched once afterwards.
  const handleCreateInProvider = async () => {
    // Unlinked parents outside the selection go too, or their children could not.
    const extra = creatable.filter((account) => !ids.includes(account.id))
    const extraNote =
      extra.length > 0
        ? ` ${extra.map((account) => formatAccountLabel(account)).join(', ')} ${extra.length === 1 ? 'is a parent that is' : 'are parents that are'} not linked yet and will be created first.`
        : ''
    const confirmed = await confirm({
      title: `Create ${creatable.length} account${creatable.length === 1 ? '' : 's'} in ${where}?`,
      description: `They will be added to ${where}'s chart of accounts one at a time, parents first, and linked here.${extraNote} Accounts already linked, or with a suggested match to accept, are skipped. ${where} cannot delete an account once it exists - it can only be made inactive.`,
      confirmText: 'Create and link',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    setPendingLabel('Creating…')
    setCreating(true)
    for (const account of creatable) addPending(account.id)
    let result: Awaited<ReturnType<typeof createInProvider.mutateAsync>> | undefined
    try {
      result = await createInProvider.mutateAsync({ glAccountIds: ids })
    } catch (error) {
      toastError({
        title: `Error creating accounts in ${where}`,
        description: error instanceof Error ? error.message : 'Could not create the accounts.',
      })
    } finally {
      for (const account of creatable) removePending(account.id)
      setCreating(false)
      await utils.ledger.accountMap.invalidate()
      // The server re-releases the failed batches this unblocks, so an Outbox
      // open in another tab is now showing a stale refusal.
      void utils.ledger.exportBatches.list.invalidate()
      void utils.ledger.exportBatches.summaryRows.invalidate()
      void utils.ledger.outboxCounts.invalidate()
    }
    if (!result) return

    const failed = result.failed
    if (failed) {
      const account = chart.data?.find((row) => row.id === failed.glAccountId)
      toastError({
        title: `Error creating ${account ? formatAccountLabel(account) : 'an account'} in ${where}`,
        description: failed.message,
      })
    }
    // Same two not-what-the-button-said outcomes the per-row hook reports, once
    // for the batch rather than once per row. No success toast: the badges flip.
    const existing = result.created.filter((row) => row.outcome === 'existing').length
    const numberDropped = result.created.filter((row) => row.numberDropped).length
    if (existing > 0 || numberDropped > 0) {
      toastError({
        title: 'Linked, but not quite as asked',
        description: [
          existing > 0 &&
            `${where} already had ${existing} of the accounts, which ${existing === 1 ? 'was' : 'were'} linked without creating anything.`,
          numberDropped > 0 &&
            `${where} has account numbers turned off, so ${numberDropped} ${numberDropped === 1 ? 'was' : 'were'} created by name only.`,
        ]
          .filter(Boolean)
          .join(' '),
      })
    }
    // A halted run keeps the selection so the rows after the failure stay picked.
    if (!failed) exit()
  }

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
      id: 'create-in-provider',
      // Counted like Remove: the label says how many of the picked rows it acts
      // on once linked or suggested rows (skipped) are in the selection.
      label:
        creatable.length === count
          ? `Create in ${where}`
          : `Create ${creatable.length} in ${where}`,
      icon: CloudUpload,
      variant: 'outline',
      tooltip: `Create the selected accounts in ${where} and link them, parents first`,
      hidden: !canCreate || creatable.length === 0,
      disabled: busy,
      onClick: () => void handleCreateInProvider(),
    },
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
      disabled: busy,
      onClick: () => void handleRestore(),
    },
    {
      id: 'remove',
      label: live.length === count ? 'Remove' : `Remove ${live.length}`,
      icon: Trash2,
      variant: 'destructive',
      tooltip: 'Take the selected accounts out of the chart',
      hidden: live.length === 0,
      disabled: busy,
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
