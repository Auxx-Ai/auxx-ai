// apps/web/src/app/(protected)/app/accounting/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import { BarChart3, BookOpenCheck, Landmark, Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { AccountingSetupWizardGate } from '~/components/accounting/ui/setup-wizard/setup-wizard-gate'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * Module header for `/app/accounting/*` — Ledger · Banking · Reports · Settings via `MainPageTabs`
 * in route mode, the same shape `dispatch/layout.tsx` uses for Board · Settings.
 *
 * ⚠️ The date/period navigation is deliberately NOT here. Dispatch keeps its
 * header to breadcrumb + tabs and puts the date nav in a toolbar inside
 * `MainPageContent` (`board-toolbar.tsx`); the ledger's period picker follows
 * that, in `ledger-toolbar.tsx`.
 */
function AccountingLayoutHeader() {
  const { can } = useAccess()

  return (
    <MainPageHeader className='justify-start'>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem title='Accounting' href='/app/accounting' />
      </MainPageBreadcrumb>
      <MainPageTabs
        items={[
          {
            value: 'ledger',
            label: 'Ledger',
            icon: <BookOpenCheck />,
            href: '/app/accounting',
            tooltip: 'Ledger',
          },
          {
            value: 'banking',
            label: 'Banking',
            icon: <Landmark />,
            href: '/app/accounting/banking',
            tooltip: 'Banking',
            hidden: !can('ledger.post'),
          },
          {
            value: 'reports',
            label: 'Reports',
            icon: <BarChart3 />,
            href: '/app/accounting/reports',
            tooltip: 'Reports',
          },
          {
            value: 'settings',
            label: 'Settings',
            icon: <Settings />,
            // The SEGMENT, not a leaf: `MainPageTabs` matches longest-prefix, so
            // a leaf href leaves every sibling settings page matching only
            // `/app/accounting` and showing Ledger as active.
            href: '/app/accounting/settings',
            tooltip: 'Settings',
            // `ledger.post`, not `ledger.control`: the segment holds General
            // (period, timezone, absorption rates, standard-cost roll), which
            // is ordinary bookkeeping an Edit holder should still reach. The
            // chart, opening balances and bank accounts pages inside the
            // segment gate themselves on `ledger.control`
            // (plans/accounting/tasks/12-accountant-permissions.md §4.3).
            hidden: !can('ledger.post'),
          },
        ]}
      />
    </MainPageHeader>
  )
}

/**
 * Module shell for `/app/accounting/*` (plans/money/tasks/13-accounting-ui.md §1).
 *
 * `AccountingSetupWizardGate` mounts here so the wizard can auto-open on first
 * visit anywhere under this route tree; it renders nothing until its own gating
 * conditions are met.
 *
 * 🛑 The `ledger.view` guard is only half the gate. `FeatureKey.accounting` is
 * enforced server-side on the `ledger` router — a feature key that only hides a
 * nav item is a fake gate, because the procedures stay callable.
 */
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isSettings = pathname.startsWith('/app/accounting/settings')
  // The segment-level floor stays `ledger.post`: the settings segment holds the
  // General page (period, timezone, absorption rates, standard cost), which is
  // ordinary bookkeeping. The chart, opening balances and bank accounts pages
  // narrow further to `ledger.control` on their own guards
  // (plans/accounting/tasks/12-accountant-permissions.md §4.3) - a Read-only
  // ledger member never reaches this segment at all.
  const permissionKey = isSettings ? 'ledger.post' : 'ledger.view'

  return (
    <CapabilityPageGuard permissionKey={permissionKey} area='Accounting'>
      <MainPage>
        <AccountingLayoutHeader />
        {children}
        <AccountingSetupWizardGate />
      </MainPage>
    </CapabilityPageGuard>
  )
}
