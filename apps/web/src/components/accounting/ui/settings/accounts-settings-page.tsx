// apps/web/src/components/accounting/ui/settings/accounts-settings-page.tsx
'use client'

// Accounting > Settings > Accounts (13-accounting-ui.md §5.4).
//
// Shape B, master-detail: `SettingsPage` + a `ResponsiveTabs` subHeader with the
// tab in `useQueryState('s')`, and a `grid-cols-[1fr_420px]` body whose right
// column is a PERSISTENT editor pane, docked at `lg` and a floating
// `DockableDrawer` below it. The products-services page is the reference.
//
// Both tabs read real rows now: `ledger.roleMap` returns one row for EVERY role
// in `ACCOUNT_ROLES` (mapped or not, so the list is a checklist rather than a
// table dump) and `ledger.chartAccounts` returns the org's live `gl_account`
// instances.
//
// 🛑 BOTH tabs write, and every write on this page is on `ledgerPost` - the
// Full rung of the ledger area. `gl_account` stays `isVisible: false` and this
// page is its only door, deliberately: `record.create` asserts the generic
// RECORDS capability, so routing the chart through it would let records-Full /
// ledger-None decide where money lands. See `routers/ledger.ts`.
//
// The chart tab keeps a phantom draft (`ChartDraftHandle`) exactly as the
// products-services page does, with one difference: the create fires on an
// explicit button, not on a commit. `gl_account` has three required fields to
// `catalog_item`'s one, and a unique-code conflict belongs on an act somebody
// knowingly performed.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type {
  AccountRole,
  ChartAccountRow,
  GlAccountTypeValue,
  RoleAssignmentRow,
} from '@auxx/lib/postings/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { Landmark, Link2, Lock, Waypoints } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { AccountMapList } from './account-map-list'
import type { ChartDraftHandle } from './accounts-types'
import { ChartAccountEditor } from './chart-account-editor'
import { ChartList } from './chart-list'
import { RoleMapEditor } from './role-map-editor'
import { RoleMapList } from './role-map-list'

type AccountsTab = 'roles' | 'chart' | 'quickbooks'

const TABS = [
  { value: 'roles', label: 'Roles', icon: Waypoints },
  { value: 'chart', label: 'Chart of accounts', icon: Landmark },
  { value: 'quickbooks', label: 'QuickBooks', icon: Link2 },
]

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Accounts' },
]

const PAGE_DESCRIPTION =
  'Which account each posting role lands on, the chart those accounts live in, and which account in QuickBooks each one corresponds to.'

export function AccountingAccountsSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'roles' as string })
  const activeTab: AccountsTab =
    tab === 'chart' ? 'chart' : tab === 'quickbooks' ? 'quickbooks' : 'roles'

  const roleMap = api.ledger.roleMap.useQuery()
  const chart = api.ledger.chartAccounts.useQuery()
  // Chart tab only: how many posted lines carry each CODE, for the renumber
  // note. A separate read rather than a field on `ChartAccountRow`, which is
  // shared with the resolver's path and decoded by every reader of this chart.
  const chartUsage = api.ledger.chartAccountUsage.useQuery()

  const [selectedRole, setSelectedRole] = useState<AccountRole | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  // The phantom draft for the Chart tab. The full field set lives inside the
  // draft form instance (keyed by `draftId`); this page tracks only enough to
  // render the list's phantom row and to know whether the selection is a draft.
  // An untouched draft is dropped on selecting another row, on adding another
  // draft, or on switching tabs - never on a mere re-render.
  const [chartDraft, setChartDraft] = useState<ChartDraftHandle | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const isDesktop = useMedia('(min-width: 1024px)')

  const roleRows = useMemo<RoleAssignmentRow[]>(() => roleMap.data ?? [], [roleMap.data])
  const accounts = useMemo(() => chart.data ?? [], [chart.data])

  const rowsByRole = useMemo(() => new Map(roleRows.map((row) => [row.role, row])), [roleRows])

  /** Which roles point at each account. Renders the "2 roles" note on a chart row. */
  const rolesByAccountId = useMemo(() => {
    const map = new Map<string, AccountRole[]>()
    for (const row of roleRows) {
      if (!row.accountId) continue
      const list = map.get(row.accountId) ?? []
      list.push(row.role as AccountRole)
      map.set(row.accountId, list)
    }
    return map
  }, [roleRows])

  // ── The one write on this page ───────────────────────────────────────────
  //
  // 🛑 `setRoleAssignment` already refuses an unknown role, a missing or
  // archived account, an inactive account and a type-incompatible one, each with
  // a message naming the role and the problem. That message is surfaced VERBATIM
  // rather than re-checked here: a second client-side authority would drift, and
  // replacing "'grni' must be mapped to a liability account, but 4000 Sales is a
  // revenue account" with "Could not save" throws away the only sentence that
  // says what to do next.
  const setRole = api.ledger.setRoleAssignment.useMutation({
    onSuccess: () => {
      void utils.ledger.roleMap.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error saving the role map', description: error.message })
    },
  })

  function handleAssignRole(role: AccountRole, accountId: string) {
    // Picking an account is what turns a suggestion into a confirmation; that is
    // the whole point of `G19` step 4. The server stamps `confirmedAt`.
    setRole.mutate({ role, glAccountId: accountId })
  }

  /**
   * Mark a role unused, or clear that mark.
   *
   * 🛑 Never called on an `unmapped` role. `GlRoleAssignment.glAccountId` is
   * `NOT NULL`, so there is no row to flip and the server answers `NotFoundError`.
   * Both callers hide or disable the affordance in that state - the list drops
   * the button, the editor renders it disabled beside the reason - so the refusal
   * is explained before it can be provoked rather than after.
   */
  function handleToggleUnused(role: AccountRole) {
    const current = rowsByRole.get(role)
    if (!current || current.state === 'unmapped') return
    setRole.mutate({ role, markedUnused: current.state !== 'unused' })
  }

  // ── The chart writes ────────────────────────────────────────────────────
  //
  // 🛑 Every refusal below is surfaced VERBATIM, for the reason `setRole` above
  // states: the server's sentence names the role, the account and what to do
  // next, and "Could not save" throws that away. Nothing is re-validated here.
  //
  // The mutations expose `mutateAsync` to the editor rather than firing toasts,
  // because a chart refusal belongs on the FIELD that caused it - the code that
  // collided, the type a role cannot accept - not in a corner of the screen.
  const createAccount = api.ledger.chartAccountCreate.useMutation()
  const updateAccount = api.ledger.chartAccountUpdate.useMutation()
  const removeAccount = api.ledger.chartAccountRemove.useMutation()

  /** A rename or a renumber changes the account rendered on every role row too. */
  const invalidateChart = useCallback(async () => {
    await Promise.all([utils.ledger.chartAccounts.invalidate(), utils.ledger.roleMap.invalidate()])
  }, [utils])

  const handleCreateAccount = useCallback(
    async (values: {
      code: string
      name: string
      accountType: GlAccountTypeValue
      isActive: boolean
    }): Promise<ChartAccountRow> => {
      const created = await createAccount.mutateAsync(values)
      await invalidateChart()
      return created
    },
    [createAccount, invalidateChart]
  )

  const handleUpdateAccount = useCallback(
    async (
      id: string,
      patch: {
        code?: string
        name?: string
        accountType?: GlAccountTypeValue | null
        isActive?: boolean
      }
    ): Promise<ChartAccountRow> => {
      const updated = await updateAccount.mutateAsync({
        id,
        code: patch.code,
        name: patch.name,
        // `null` is the draft form's "not chosen yet"; it never reaches a write.
        accountType: patch.accountType ?? undefined,
        isActive: patch.isActive,
      })
      await invalidateChart()
      return updated
    },
    [updateAccount, invalidateChart]
  )

  /**
   * Remove is ARCHIVE server-side, and the confirm says what that means.
   *
   * 🛑 The refusal when a role still posts here is the server's, not a
   * pre-check: a client-side copy of `liveRolesFor` would be a second authority
   * over the one question this page must not get wrong.
   */
  const handleRemoveAccount = useCallback(
    async (id: string) => {
      const account = accounts.find((row) => row.id === id)
      const confirmed = await confirm({
        title: 'Remove account?',
        description: `${account ? `${account.code} ${account.name} ` : 'This account '}comes out of the chart. Entries already posted keep the code and the name they were written with, and a re-seed will not bring it back.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return

      await removeAccount.mutateAsync({ id })
      await invalidateChart()
      if (selectedAccountId === id) setSelectedAccountId(null)
    },
    [accounts, confirm, removeAccount, invalidateChart, selectedAccountId]
  )

  // ── The phantom draft ───────────────────────────────────────────────────

  function handleSelectAccount(id: string | null) {
    // Selecting anything other than the draft itself - or its committed record,
    // which keeps the draft form mounted - drops the draft.
    if (chartDraft && id !== chartDraft.draftId && id !== chartDraft.recordId) {
      setChartDraft(null)
    }
    setSelectedAccountId(id)
  }

  function handleAddChartDraft() {
    if (chartDraft && !chartDraft.recordId) {
      setSelectedAccountId(chartDraft.draftId) // uncommitted one exists - re-select it
      return
    }
    const draftId = generateId('draft')
    setChartDraft({ draftId, code: '', name: '' })
    setSelectedAccountId(draftId)
  }

  function handleChartDraftChange(patch: { code?: string; name?: string }) {
    setChartDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  /** First create resolved: swap selection to the real id but KEEP the draft, so
   *  the draft form stays mounted and text typed mid-round-trip is not lost. */
  function handleChartDraftCommitted(recordId: string) {
    setChartDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedAccountId(recordId)
  }

  function handleTabChange(next: string) {
    // An untouched draft does not survive a tab switch - the other tab's list no
    // longer renders the phantom row, so hanging onto it would be confusing.
    if (chartDraft) setChartDraft(null)
    setTab(next)
  }

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage title='Accounts' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  const editorContent =
    activeTab === 'roles' ? (
      <RoleMapEditor
        role={selectedRole}
        assignment={selectedRole ? rowsByRole.get(selectedRole) : undefined}
        accounts={accounts}
        accountsLoading={chart.isPending}
        pending={setRole.isPending}
        onAssign={handleAssignRole}
        onToggleUnused={handleToggleUnused}
      />
    ) : (
      <ChartAccountEditor
        selectedId={selectedAccountId}
        accounts={accounts}
        roles={selectedAccountId ? (rolesByAccountId.get(selectedAccountId) ?? []) : []}
        usage={chartUsage.data ?? {}}
        draft={chartDraft}
        onDraftChange={handleChartDraftChange}
        onCreate={handleCreateAccount}
        onDraftCommitted={handleChartDraftCommitted}
        onUpdate={handleUpdateAccount}
        onRemove={handleRemoveAccount}
      />
    )

  const selectedId = activeTab === 'roles' ? selectedRole : selectedAccountId
  // 🛑 The QuickBooks tab is NOT master-detail. Its rows are edited in place by
  // a picker, so there is nothing for a right-hand editor pane to hold and a
  // drawer would open onto an empty panel on mobile.
  const mobileDrawerOpen = activeTab !== 'quickbooks' && !isDesktop && !!selectedId

  return (
    <SettingsPage
      title='Accounts'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} size='sm' items={TABS} />
      }>
      {activeTab === 'quickbooks' ? (
        <div className='min-w-0 p-4'>
          <AccountMapList />
        </div>
      ) : (
        <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
          <div className='min-w-0'>
            {activeTab === 'roles' ? (
              <RoleMapList
                rows={roleRows}
                // 🛑 Gate on the query, never on an empty array. Thirteen rows
                // reading "Not mapped - every preview refuses until this is set"
                // is a CLAIM about the org, and rendering it mid-load makes it a
                // false one.
                isLoading={roleMap.isPending}
                selectedRole={selectedRole}
                onSelect={setSelectedRole}
                onToggleUnused={handleToggleUnused}
              />
            ) : (
              <ChartList
                accounts={accounts}
                isLoading={chart.isPending}
                selectedId={selectedAccountId}
                onSelect={handleSelectAccount}
                rolesByAccountId={rolesByAccountId}
                draft={chartDraft}
                onAddDraft={handleAddChartDraft}
              />
            )}
          </div>
          {/* The column stays STRETCHED and a wrapper inside it does the sticking.
            Making the column itself `self-start` would size it to the editor, and
            `border-l` would then stop dead at the editor's bottom edge instead of
            dividing the whole list. A stretched column also gives the sticky child
            room to travel, which an already-full-height element does not have.

            `--settings-sticky-top` is published by `SettingsPage`, which owns the
            `sticky top-0 z-20` title/tabs block above - pinning at a hardcoded `0`
            would slide this underneath it. `z-10` matches `FormSaveBar`, i.e.
            deliberately below that header. */}
          <div className='hidden border-l lg:block'>
            <div
              className='lg:sticky lg:z-10 lg:overflow-hidden'
              style={{
                top: 'var(--settings-sticky-top, 0px)',
                maxHeight:
                  'calc(var(--settings-viewport-h, 100vh) - var(--settings-sticky-top, 0px))',
              }}>
              {editorContent}
            </div>
          </div>
        </div>
      )}

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRole(null)
            handleSelectAccount(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title={activeTab === 'roles' ? 'Map role' : 'Account'}>
        {editorContent}
      </DockableDrawer>

      <ConfirmDialog />
    </SettingsPage>
  )
}
