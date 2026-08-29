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
// 🛑 The Roles tab WRITES; the Chart tab is READ-ONLY. `ledger.setRoleAssignment`
// exists; there is no create/update procedure for `gl_account` through any
// surface yet, so the chart is presented as a reference list with a detail pane
// that has no inputs at all. A disabled-looking form that silently discarded
// what somebody typed would be strictly worse than not offering the field.

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { AccountRole, RoleAssignmentRow } from '@auxx/lib/postings/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { toastError } from '@auxx/ui/components/toast'
import { Landmark, Lock, Waypoints } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useMedia } from '~/hooks/use-media'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { ChartAccountDetail } from './chart-account-editor'
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

export function AccountingAccountsSettingsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'roles' as string })
  const activeTab: AccountsTab = tab === 'chart' ? 'chart' : 'roles'

  const roleMap = api.ledger.roleMap.useQuery()
  const chart = api.ledger.chartAccounts.useQuery()

  const [selectedRole, setSelectedRole] = useState<AccountRole | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

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

  function handleTabChange(next: string) {
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
      <ChartAccountDetail
        selectedId={selectedAccountId}
        accounts={accounts}
        roles={selectedAccountId ? (rolesByAccountId.get(selectedAccountId) ?? []) : []}
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
              onSelect={setSelectedAccountId}
              rolesByAccountId={rolesByAccountId}
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

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRole(null)
            setSelectedAccountId(null)
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
    </SettingsPage>
  )
}
