// apps/web/src/components/accounting/ui/settings/bank-accounts-settings-page.tsx
'use client'

// Accounting > Settings > Bank accounts (plans/accounting/ui-plan.md §2.7,
// HANDOFF slot 2I).
//
// Shape B, master-detail: `SettingsPage` + `MasterDetailSplit` with the account
// list on the left and a `FieldPanel` editor on the right - the
// `accounts-settings-page.tsx` shape, minus the tab strip, because there is only
// one thing on this page.
//
// 🛑 Every write here is on `ledgerControl`, the Full rung of the ledger area
// (plans/accounting/tasks/12-accountant-permissions.md §4.3), and not because
// it produces a posting. Mapping a bank account to a GL code decides where
// CASH lands on the balance sheet; routing that through a records-grade
// capability would let records-Full / ledger-None move the org's cash account.
// Same argument as the chart's own writes in `routers/ledger.ts`.
//
// 🛑 Connect, Reconnect, Sync now and Disconnect all live here (slot 3A) and all
// branch on WHAT CAME BACK, never on which provider is behind the feed (decision
// B13). `BankAccountConnectDialog` owns the flow; this page owns the mutations
// and what the list and the editor do with their results.
//
// 🛑 Disconnect does two things and neither is a delete: the connector and the
// `bank_account` go `disconnected`, and the account is RELEASED at Stripe so it
// stops being billed 30c a month (open question S4). Every transaction stays - a
// coded and posted bank line is the source document of a journal entry.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { Lock } from 'lucide-react'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { BankAccountConnectDialog } from './bank-account-connect-dialog'
import { BankAccountEditor, type BankAccountPatch } from './bank-account-editor'
import { BankAccountManualDialog } from './bank-account-manual-dialog'
import { BankAccountsList } from './bank-accounts-list'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Bank accounts' },
]

const PAGE_DESCRIPTION =
  'The accounts your money actually sits in, and which account in your chart each one maps to. Everything the bank feed and the statement importer produce lands against a row here.'

export function BankAccountsSettingsPage() {
  // 🛑 `ledgerControl`, not `ledgerView` or `ledgerPost`. Every control on this
  // page is a WRITE - the mapping, the manual add, connect, sync and disconnect
  // - and the page has no read-only rendering, so a lower gate handed a viewer
  // live controls the server then refused one by one. Same rung the header
  // above argues for.
  useRequireCapability(PermissionKey.ledgerControl)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  // 🛑 The row selection lives in the URL, like the chart's does on
  // `settings/accounts`. This is the screen people are sent to ("map the
  // checking account to 1010"), and a pane that vanishes on refresh cannot be
  // linked to.
  const [accountParam, setSelectedId] = useQueryState('account')
  const [manualOpen, setManualOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  // In the URL too, for the same reason: "here is the archived one I mean" is a
  // link somebody sends, and the row it names is not on the list without this.
  const [showArchived, setShowArchived] = useQueryState(
    'archived',
    parseAsBoolean.withDefault(false)
  )
  const [confirm, ConfirmDialog] = useConfirm()

  // 🛑 Archived rows are FETCHED always and filtered here, on the same query key
  // `useBankAccounts` uses, so the toggle costs no roundtrip and every picker on
  // the app shares this cache entry.
  const accounts = api.banking.bankAccount.list.useQuery({ includeArchived: true })
  const rows = useMemo(() => accounts.data ?? [], [accounts.data])
  const visibleRows = useMemo(
    () => (showArchived ? rows : rows.filter((row) => !row.archivedAt)),
    [rows, showArchived]
  )

  // 🛑 The param is only REJECTED once the list has arrived. Validating while
  // the query is pending would drop the selection on every refresh - the URL is
  // read before the data is, so the row it names does not exist yet.
  const selectedId =
    accountParam && (accounts.isPending || rows.some((row) => row.id === accountParam))
      ? accountParam
      : null
  // Selected from ALL rows, not the visible ones: archiving the open account
  // must leave its pane readable long enough to say what happened and offer the
  // restore, rather than blanking under the person who pressed the button.
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId]
  )

  // Gated on a selection: deriving gaps reads every transaction date on the
  // account, which is the one unbounded query behind this page. Paying it for
  // the open row is fine; paying it for every row is not.
  const coverage = api.banking.bankAccount.coverage.useQuery(
    { id: selectedId ?? '' },
    { enabled: !!selectedId }
  )

  // What the Danger zone's button says, and what the confirm dialog counts.
  // 🛑 Advisory only - `bankAccount.remove` re-runs the gate server side, so a
  // sync that lands a transaction between this read and the click cannot turn a
  // delete into something it should not have been.
  const removal = api.banking.bankAccount.removalPreview.useQuery(
    { id: selectedId ?? '' },
    { enabled: !!selectedId && !selected?.archivedAt }
  )

  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.banking.bankAccount.list.invalidate(),
      utils.banking.bankAccount.coverage.invalidate(),
      utils.banking.bankAccount.removalPreview.invalidate(),
    ])
  }, [utils])

  // 🛑 Refusals are surfaced VERBATIM. `updateBankAccount` says which field a
  // connected account owns and what to do instead. Replacing it with "Could not
  // save" throws away the only sentence that says what to do next.
  const update = api.banking.bankAccount.update.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error saving the account', description: error.message })
    },
  })

  const connect = api.banking.connect.useMutation()
  const reconnect = api.banking.reconnect.useMutation()

  const sync = api.banking.sync.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      // 🛑 Verbatim. `syncBankAccountFeed` refuses a disconnected feed with the
      // sentence that says what to do instead; "Could not sync" throws it away.
      toastError({ title: 'Error starting the sync', description: error.message })
    },
  })

  const disconnect = api.banking.disconnect.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error disconnecting the account', description: error.message })
    },
  })

  const remove = api.banking.bankAccount.remove.useMutation({
    onSuccess: async (result) => {
      await invalidate()
      // A deleted account has no row left to select. An archived one does, and
      // keeping it selected is what puts Restore in front of the person who has
      // just realised they did not mean it.
      if (result.verb === 'delete') setSelectedId(null)
    },
    onError: (error) => {
      toastError({ title: 'Error removing the account', description: error.message })
    },
  })

  const restore = api.banking.bankAccount.restore.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error restoring the account', description: error.message })
    },
  })

  // One dialog serves both doors: a reconnect is a fresh authentication that lands
  // on the account the org already has (Financial Connections has no "repair this
  // account" call), and `provisionBankFeed` re-arms the existing connector rather
  // than standing a second feed up beside it.
  const startConnection = useCallback(async () => {
    return reconnectingId
      ? await reconnect.mutateAsync({ id: reconnectingId })
      : await connect.mutateAsync()
  }, [connect, reconnect, reconnectingId])

  const handleConnected = useCallback(
    async (accounts: number) => {
      await invalidate()
      setReconnectingId(null)
      if (accounts > 0) setSelectedId(null)
    },
    [invalidate, setSelectedId]
  )

  const handlePatch = useCallback(
    (patch: BankAccountPatch) => {
      if (!selectedId) return
      update.mutate({ id: selectedId, ...patch })
    },
    [selectedId, update]
  )

  const handleDisconnect = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Disconnect this account?',
      description:
        'The feed stops and the account is released at your bank, so it stops being billed. Every transaction already synced stays, including the ones you have coded and posted - a posted bank line is the source document of a journal entry, so nothing is deleted. Reconnecting later means signing in at your bank again.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    disconnect.mutate({ id: selected.id })
  }, [selected, confirm, disconnect])

  /**
   * Delete or archive, whichever the server's gate says applies.
   *
   * 🛑 The confirm text NAMES THE COUNTS. "This cannot be undone" over an
   * unnamed cascade is what people click through; "1,240 transactions, 3 of them
   * matched to documents" is what makes somebody stop and check.
   */
  const handleRemove = useCallback(async () => {
    if (!selected || !removal.data) return
    const preview = removal.data
    const confirmed = await confirm({
      title:
        preview.verb === 'delete'
          ? `Delete ${selected.name?.trim() || 'this bank account'}?`
          : `Archive ${selected.name?.trim() || 'this bank account'}?`,
      description:
        preview.verb === 'delete'
          ? [
              `Nothing on this account has ever reached the ledger, so it is removed for good with its ${countLabel(preview.cascade.transactions, 'transaction')}.`,
              preview.cascade.matched > 0
                ? `${countLabel(preview.cascade.matched, 'of them is', 'of them are')} matched to a document. The document and its journal entry stay in the books; only the bank line confirming it goes.`
                : null,
              preview.cascade.releasesAtStripe
                ? 'The bank connection is released at your bank, so it stops being billed. Reconnecting later means signing in again.'
                : null,
              warningLine(preview.warnings, 'deleting'),
              'This cannot be undone.',
            ]
              .filter(Boolean)
              .join(' ')
          : [
              'Something on this account has been posted to the ledger, so it is archived rather than deleted. It leaves every list and picker; the transactions, the journal entries and the account you mapped it to are all untouched.',
              preview.unreviewed > 0
                ? `${countLabel(preview.unreviewed, 'transaction is', 'transactions are')} still waiting for review. Archiving marks them excluded, so they will not reach the books.`
                : null,
              preview.cascade.releasesAtStripe
                ? 'The feed is disconnected and the account is released at your bank first, so it stops being billed.'
                : null,
              warningLine(preview.warnings, 'archiving'),
              'You can restore it from Show archived.',
            ]
              .filter(Boolean)
              .join(' '),
      confirmText: preview.verb === 'delete' ? 'Delete' : 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    remove.mutate({ id: selected.id })
  }, [selected, removal.data, confirm, remove])

  const handleReconnect = useCallback((id: string) => {
    setReconnectingId(id)
    setConnectOpen(true)
  }, [])

  const handleConnect = useCallback(() => {
    setReconnectingId(null)
    setConnectOpen(true)
  }, [])

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage title='Bank accounts' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title='Bank accounts' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <MasterDetailSplit
        id='accounting-bank-accounts'
        pane={
          <BankAccountEditor
            account={selected}
            coverage={coverage.data ?? null}
            coverageLoading={!!selectedId && coverage.isPending}
            pending={update.isPending}
            disconnecting={disconnect.isPending}
            syncing={sync.isPending}
            removal={removal.data ?? null}
            removing={remove.isPending}
            onPatch={handlePatch}
            onSync={() => selected && sync.mutate({ id: selected.id })}
            onReconnect={() => selected && handleReconnect(selected.id)}
            onDisconnect={handleDisconnect}
            onRemove={handleRemove}
            onRestore={() => selected && restore.mutate({ id: selected.id })}
            restoring={restore.isPending && restore.variables?.id === selected?.id}
          />
        }
        paneTitle='Bank account'
        paneOpen={!!selected}
        onPaneClose={() => setSelectedId(null)}>
        <BankAccountsList
          accounts={visibleRows}
          isLoading={accounts.isPending}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConnect={handleConnect}
          onAddManually={() => setManualOpen(true)}
          onSync={(id) => sync.mutate({ id })}
          onReconnect={handleReconnect}
          onRestore={(id) => restore.mutate({ id })}
          connecting={connect.isPending || reconnect.isPending}
          syncingId={sync.isPending ? (sync.variables?.id ?? null) : null}
          restoringId={restore.isPending ? (restore.variables?.id ?? null) : null}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          archivedCount={rows.filter((row) => row.archivedAt).length}
        />
      </MasterDetailSplit>

      <BankAccountManualDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={async (account) => {
          // The dialog already invalidated the list; coverage is this page's own
          // read, and selecting the new row is what makes the editor open on it.
          await utils.banking.bankAccount.coverage.invalidate()
          setSelectedId(account.id)
        }}
      />

      <BankAccountConnectDialog
        open={connectOpen}
        onOpenChange={(next) => {
          setConnectOpen(next)
          if (!next) setReconnectingId(null)
        }}
        onStart={startConnection}
        onConnected={handleConnected}
        reconnecting={!!reconnectingId}
      />

      <ConfirmDialog />
    </SettingsPage>
  )
}

/** `3 transactions` / `1 transaction`, so no sentence reads "1 transactions". */
function countLabel(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

/**
 * The inert-rule warning, or null.
 *
 * ⚠️ Named, never a blocker. `evaluateRules` skips a rule whose `bankAccountId`
 * does not match the line, so a rule left pointing at a removed account is
 * silently DEAD rather than silently universal - which is worth saying, and not
 * worth refusing over.
 */
function warningLine(rules: { id: string; name: string }[], verb: string): string | null {
  if (rules.length === 0) return null
  const names = rules.map((rule) => rule.name).join(', ')
  return `${rules.length === 1 ? 'One rule' : `${rules.length} rules`} name this account (${names}); ${verb} it leaves ${rules.length === 1 ? 'it' : 'them'} matching nothing.`
}
