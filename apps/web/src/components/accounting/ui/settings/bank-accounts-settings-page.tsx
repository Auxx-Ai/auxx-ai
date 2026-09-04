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
// 🛑 Every write here is on `ledgerPost`, the Full rung of the ledger area, and
// not because it produces a posting. Mapping a bank account to a GL code decides
// where CASH lands on the balance sheet; routing that through a records-grade
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

import { FieldType } from '@auxx/database/enums'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '@auxx/ui/components/toast'
import { Building2, Lock } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { BankAccountConnectDialog } from './bank-account-connect-dialog'
import { BankAccountEditor, type BankAccountPatch } from './bank-account-editor'
import { BankAccountsList } from './bank-accounts-list'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Bank accounts' },
]

const PAGE_DESCRIPTION =
  'The accounts your money actually sits in, and which account in your chart each one maps to. Everything the bank feed and the statement importer produce lands against a row here.'

const TYPE_OPTIONS = [
  { value: 'depository', label: 'Depository', color: 'blue' as const },
  { value: 'credit', label: 'Credit', color: 'amber' as const },
]

/** The manual-add dialog's fields, as it holds them before the write. */
interface ManualDraft {
  name: string
  institution: string
  last4: string
  type: 'depository' | 'credit'
  currency: string
}

const EMPTY_DRAFT: ManualDraft = {
  name: '',
  institution: '',
  last4: '',
  type: 'depository',
  currency: 'USD',
}

export function BankAccountsSettingsPage() {
  // 🛑 `ledgerPost`, not `ledgerView`. Every control on this page is a WRITE -
  // the mapping, the manual add, connect, sync and disconnect - and the page has
  // no read-only rendering, so a `ledgerView` gate handed a viewer live controls
  // the server then refused one by one. Same rung the header above argues for.
  useRequireCapability(PermissionKey.ledgerPost)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_DRAFT)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const accounts = api.banking.bankAccount.list.useQuery()
  const rows = useMemo(() => accounts.data ?? [], [accounts.data])
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

  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.banking.bankAccount.list.invalidate(),
      utils.banking.bankAccount.coverage.invalidate(),
    ])
  }, [utils])

  // 🛑 Refusals are surfaced VERBATIM. `updateBankAccount` says which field a
  // connected account owns and what to do instead; `createBankAccount` says
  // that the last four is digits only. Replacing either with "Could not save"
  // throws away the only sentence that says what to do next.
  const create = api.banking.bankAccount.create.useMutation({
    onSuccess: async (account) => {
      await invalidate()
      setManualOpen(false)
      setDraft(EMPTY_DRAFT)
      setSelectedId(account.id)
    },
    onError: (error) => {
      toastError({ title: 'Error adding the account', description: error.message })
    },
  })

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
    [invalidate]
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
            onPatch={handlePatch}
            onSync={() => selected && sync.mutate({ id: selected.id })}
            onReconnect={() => selected && handleReconnect(selected.id)}
            onDisconnect={handleDisconnect}
          />
        }
        paneTitle='Bank account'
        paneOpen={!!selected}
        onPaneClose={() => setSelectedId(null)}>
        <BankAccountsList
          accounts={rows}
          isLoading={accounts.isPending}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConnect={handleConnect}
          onAddManually={() => setManualOpen(true)}
          onSync={(id) => sync.mutate({ id })}
          onReconnect={handleReconnect}
          connecting={connect.isPending || reconnect.isPending}
          syncingId={sync.isPending ? (sync.variables?.id ?? null) : null}
        />
      </MasterDetailSplit>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a bank account</DialogTitle>
            <DialogDescription>
              For an account you will import statements into, or one at an institution the feed does
              not cover. Map it to your chart afterwards.
            </DialogDescription>
          </DialogHeader>

          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='accounting-bank-account-add'
            defaultLabelWidth={140}
            className='p-0'>
            <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.name}
                placeholder='Business Adv Relationship'
                disabled={create.isPending}
                onChange={(value) => setDraft({ ...draft, name: (value as string) ?? '' })}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Institution' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.institution}
                placeholder='Bank of America'
                disabled={create.isPending}
                onChange={(value) => setDraft({ ...draft, institution: (value as string) ?? '' })}
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Last four'
              type={BaseType.STRING}
              showIcon
              description='Digits only. Stored as text, so a leading zero survives.'>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.last4}
                placeholder='5381'
                disabled={create.isPending}
                onChange={(value) => setDraft({ ...draft, last4: (value as string) ?? '' })}
              />
            </FieldPanelRow>
            <FieldPanelRow
              title='Type'
              type={BaseType.ENUM}
              showIcon
              description='A credit card is a liability and maps to a liability account.'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: TYPE_OPTIONS }}
                value={draft.type}
                disabled={create.isPending}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
                placeholder='Select type'
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  if (next === 'depository' || next === 'credit') setDraft({ ...draft, type: next })
                }}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Currency' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={draft.currency}
                placeholder='USD'
                disabled={create.isPending}
                onChange={(value) => setDraft({ ...draft, currency: (value as string) ?? '' })}
              />
            </FieldPanelRow>
          </FieldPanel>

          <DialogFooter>
            <Button variant='ghost' onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              loadingText='Adding...'
              disabled={!draft.name.trim()}
              onClick={() =>
                create.mutate({
                  name: draft.name.trim(),
                  institution: draft.institution.trim() || null,
                  last4: draft.last4.trim() || null,
                  type: draft.type,
                  currency: draft.currency.trim() || null,
                })
              }>
              <Building2 />
              Add account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
