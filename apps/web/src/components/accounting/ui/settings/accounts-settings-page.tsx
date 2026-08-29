// apps/web/src/components/accounting/ui/settings/accounts-settings-page.tsx
'use client'

// Accounting > Settings > Accounts (13-accounting-ui.md §5.4).
//
// Shape B, master-detail: `SettingsPage` + a `ResponsiveTabs` subHeader with the
// tab in `useQueryState('s')`, and a `grid-cols-[1fr_420px]` body whose right
// column is a PERSISTENT editor pane, docked at `lg` and a floating
// `DockableDrawer` below it. The products-services page is the reference.
//
// 🛑 PLACEHOLDER STATE. Neither tab has a procedure behind it:
//   * the role map would need `GlRoleAssignment` read/write, which does not
//     exist, which is why `resolveRoles` returns `account_unmapped` in every
//     org today;
//   * the chart would need `gl_account` record reads/writes through this
//     surface.
// So both run on `components/accounting/fixtures.ts` seeds plus local state.
// Every handler below is shaped like the mutation that will replace it.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { ACCOUNT_ROLES, type AccountRole } from '@auxx/lib/postings/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { generateId } from '@auxx/utils'
import { Landmark, Lock, Waypoints } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { FIXTURE_CHART, FIXTURE_ROLE_ACCOUNTS, FIXTURE_ROLE_ASSIGNMENT_STATE } from '../../fixtures'
import { useAccountingSettingsFreeze } from '../../hooks/use-accounting-settings-freeze'
import type { ChartAccount, ChartDraftHandle, RoleAssignment } from './accounts-types'
import { ChartAccountEditor } from './chart-account-editor'
import { ChartList } from './chart-list'
import { RoleMapEditor } from './role-map-editor'
import { RoleMapList } from './role-map-list'

type AccountsTab = 'roles' | 'chart'

const TABS = [
  { value: 'roles', label: 'Roles', icon: Waypoints },
  { value: 'chart', label: 'Chart of accounts', icon: Landmark },
]

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Accounts' },
]

const PAGE_DESCRIPTION =
  'Which account each posting role lands on, and the chart those accounts live in.'

const ALL_ROLES = Object.values(ACCOUNT_ROLES) as AccountRole[]

/** PLACEHOLDER: replaced by a `gl_account` record list. */
function seedChart(): ChartAccount[] {
  return FIXTURE_CHART.map((row) => ({ ...row }))
}

/** PLACEHOLDER: replaced by a `GlRoleAssignment` read. */
function seedAssignments(accounts: ChartAccount[]): Record<string, RoleAssignment> {
  const byCode = new Map(accounts.map((account) => [account.code, account]))
  const seeded: Record<string, RoleAssignment> = {}
  for (const role of ALL_ROLES) {
    const state = FIXTURE_ROLE_ASSIGNMENT_STATE[role] ?? 'unmapped'
    const code = FIXTURE_ROLE_ACCOUNTS[role]?.code
    const account = code ? byCode.get(code) : undefined
    seeded[role] = {
      state,
      accountId: state === 'unused' ? null : (account?.id ?? null),
    }
    // A role the fixture claims is mapped but whose account is missing from the
    // chart is unmapped, not quietly confirmed against nothing.
    if (seeded[role].accountId === null && state !== 'unused') seeded[role].state = 'unmapped'
  }
  return seeded
}

export function AccountingAccountsSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const { frozen: postingsExist } = useAccountingSettingsFreeze()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'roles' as string })
  const activeTab: AccountsTab = tab === 'chart' ? 'chart' : 'roles'

  const [accounts, setAccounts] = useState<ChartAccount[]>(seedChart)
  const [assignments, setAssignments] = useState<Record<string, RoleAssignment>>(() =>
    seedAssignments(seedChart())
  )

  const [selectedRole, setSelectedRole] = useState<AccountRole | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  // The phantom draft. An untouched draft is dropped silently on selecting
  // another row, adding another draft, or switching tabs. Never on a re-render.
  const [chartDraft, setChartDraft] = useState<ChartDraftHandle | null>(null)

  const isDesktop = useMedia('(min-width: 1024px)')

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  )

  /** Which roles point at each account. Drives the delete refusal. */
  const rolesByAccountId = useMemo(() => {
    const map = new Map<string, AccountRole[]>()
    for (const role of ALL_ROLES) {
      const accountId = assignments[role]?.accountId
      if (!accountId) continue
      const list = map.get(accountId) ?? []
      list.push(role)
      map.set(accountId, list)
    }
    return map
  }, [assignments])

  const isCodeTaken = (code: string, exceptId: string | null) =>
    accounts.some((account) => account.code === code && account.id !== exceptId)

  // ── Roles tab ────────────────────────────────────────────────────────────

  function handleAssignRole(role: AccountRole, accountId: string) {
    // PLACEHOLDER: replaced by a `GlRoleAssignment` upsert. Picking an account
    // is what turns a suggestion into a confirmation; that is the whole point
    // of `G19` step 4.
    setAssignments((prev) => ({ ...prev, [role]: { accountId, state: 'confirmed' } }))
  }

  function handleClearRole(role: AccountRole) {
    // PLACEHOLDER: replaced by a `GlRoleAssignment` delete.
    setAssignments((prev) => ({ ...prev, [role]: { accountId: null, state: 'unmapped' } }))
  }

  function handleToggleUnused(role: AccountRole) {
    setAssignments((prev) => {
      const current = prev[role] ?? { accountId: null, state: 'unmapped' as const }
      if (current.state === 'unused') {
        return {
          ...prev,
          [role]: {
            accountId: current.accountId,
            state: current.accountId ? 'confirmed' : 'unmapped',
          },
        }
      }
      return { ...prev, [role]: { accountId: null, state: 'unused' } }
    })
  }

  // ── Chart tab ────────────────────────────────────────────────────────────

  function handleSelectAccount(id: string | null) {
    // Selecting anything other than the draft itself, or its committed row
    // (which keeps the draft form mounted), drops the draft.
    if (chartDraft && id !== chartDraft.draftId && id !== chartDraft.recordId) {
      setChartDraft(null)
    }
    setSelectedAccountId(id)
  }

  function handleAddDraft() {
    if (chartDraft && !chartDraft.recordId) {
      setSelectedAccountId(chartDraft.draftId) // an uncommitted one exists; re-select it
      return
    }
    const draftId = generateId('draft')
    setChartDraft({ draftId, code: '', name: '' })
    setSelectedAccountId(draftId)
  }

  function handleDraftChange(patch: { code?: string; name?: string }) {
    setChartDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  /**
   * PLACEHOLDER: replaced by `record.create` on the `gl_account` definition.
   *
   * Kept async and id-returning so the draft form's create path does not change
   * shape when the mutation lands. `checkUniqueValueTyped` will throw a
   * `UniqueValueConflictError` from the real one when the code race is lost;
   * the local check in the draft form is the same refusal, run earlier.
   */
  async function handleCreateAccount(values: Omit<ChartAccount, 'id'>): Promise<string> {
    const id = generateId('gla')
    setAccounts((prev) => [...prev, { id, ...values }])
    return id
  }

  function handleUpdateAccount(id: string, patch: Partial<Omit<ChartAccount, 'id'>>) {
    // PLACEHOLDER: replaced by `useSaveFieldValue` against the `gl_account` row.
    setAccounts((prev) =>
      prev.map((account) => (account.id === id ? { ...account, ...patch } : account))
    )
  }

  function handleDeleteAccount(account: ChartAccount) {
    // PLACEHOLDER: replaced by `record.delete`. The refusal for a mapped
    // account is enforced in `ChartList` before this is ever reached.
    setAccounts((prev) => prev.filter((row) => row.id !== account.id))
    if (selectedAccountId === account.id) setSelectedAccountId(null)
  }

  function handleToggleActive(account: ChartAccount) {
    handleUpdateAccount(account.id, { isActive: !account.isActive })
  }

  // First create resolved: swap selection to the real id but KEEP the draft, so
  // the draft editor form stays mounted and text typed during the round trip
  // survives.
  function handleDraftCommitted(recordId: string) {
    setChartDraft((prev) => (prev ? { ...prev, recordId } : prev))
    setSelectedAccountId(recordId)
  }

  function handleTabChange(next: string) {
    setTab(next)
    // An untouched draft does not survive a tab switch: the other tab's list no
    // longer renders the phantom row, so keeping it would be confusing.
    if (chartDraft) setChartDraft(null)
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
        assignment={selectedRole ? assignments[selectedRole] : undefined}
        accounts={accounts}
        onAssign={handleAssignRole}
        onClear={handleClearRole}
        onToggleUnused={handleToggleUnused}
      />
    ) : (
      <ChartAccountEditor
        selectedId={selectedAccountId}
        accounts={accounts}
        postingsExist={postingsExist}
        isCodeTaken={isCodeTaken}
        onUpdate={handleUpdateAccount}
        draft={chartDraft}
        onDraftChange={handleDraftChange}
        onCreate={handleCreateAccount}
        onDraftCommitted={handleDraftCommitted}
      />
    )

  const selectedId = activeTab === 'roles' ? selectedRole : selectedAccountId
  const mobileDrawerOpen = !isDesktop && !!selectedId

  return (
    <SettingsPage
      title='Accounts'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} size='sm' items={TABS} />
      }>
      <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-w-0'>
          {activeTab === 'roles' ? (
            <RoleMapList
              assignments={assignments}
              accountsById={accountsById}
              selectedRole={selectedRole}
              onSelect={setSelectedRole}
              onClear={handleClearRole}
              onToggleUnused={handleToggleUnused}
            />
          ) : (
            <ChartList
              accounts={accounts}
              selectedId={selectedAccountId}
              onSelect={handleSelectAccount}
              rolesByAccountId={rolesByAccountId}
              onAdd={handleAddDraft}
              onDelete={handleDeleteAccount}
              onToggleActive={handleToggleActive}
              draft={chartDraft}
            />
          )}
        </div>
        {/* The column stays STRETCHED and a wrapper inside it does the sticking.
            Making the column itself `self-start` would size it to the editor, and
            `border-l` would then stop dead at the editor's bottom edge instead of
            dividing the whole list. A stretched column also gives the sticky child
            room to travel, which an already-full-height element does not have.

            `--settings-sticky-top` is published by `SettingsPage`, which owns the
            `sticky top-0 z-20` title/tabs block above — pinning at a hardcoded `0`
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

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRole(null)
            setSelectedAccountId(null)
            setChartDraft(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title={activeTab === 'roles' ? 'Map role' : 'Edit account'}>
        {editorContent}
      </DockableDrawer>
    </SettingsPage>
  )
}
