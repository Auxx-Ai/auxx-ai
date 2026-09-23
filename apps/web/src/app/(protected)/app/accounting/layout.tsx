// apps/web/src/app/(protected)/app/accounting/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import {
  Banknote,
  BookOpen,
  BookOpenCheck,
  Building2,
  Calculator,
  FileText,
  FileUp,
  GitCompareArrows,
  HandCoins,
  Inbox,
  Landmark,
  ListChecks,
  Scale,
  Send,
  Settings,
  TrendingUp,
  Users,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AccountingToolbarOutletProvider } from '~/components/accounting/accounting-toolbar-outlet'
import { AccountingToolbar } from '~/components/accounting/ui/accounting-toolbar'
import { AccountingSetupWizardGate } from '~/components/accounting/ui/setup-wizard/setup-wizard-gate'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import {
  DockedPanelsOutletProvider,
  useDockedPanelsOutlet,
} from '~/components/global/docked-panels-outlet'
import { SecondarySidebarProvider } from '~/components/global/secondary-sidebar-provider'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'
import { useAccess } from '~/providers/capabilities-provider'

const BASE_URL = '/app/accounting'

/**
 * One rail for the whole module (81-one-accounting-shell.md §2): every row is a
 * plain `${BASE_URL}/${slug}` link, so `SidebarSecondary` is reused unmodified
 * and its search field auto-activates at 15 rows.
 *
 * 🔑 Banking carries `ledger.post` per item, which is what the deleted Banking
 * TAB gated on; `useSettingsMenu` drops the group once every item filters out.
 */
const ACCOUNTING_NAV: SidebarProps[] = [
  {
    id: 'accounting-ledger',
    label: 'Ledger',
    type: 'header',
    items: [
      {
        id: 'accounting-ledger-closeout',
        label: 'Closeout',
        slug: 'closeout',
        icon: <BookOpenCheck />,
        description: 'The month: its entry, its refusals, and everything else that posted',
        keywords: ['close', 'period', 'lock', 'journal'],
      },
      {
        id: 'accounting-ledger-outbox',
        label: 'Outbox',
        slug: 'outbox',
        icon: <Send />,
        description: 'Everything on its way out, every period: drafts, batches, refusals',
        keywords: ['approve', 'export', 'batch', 'quickbooks', 'send'],
      },
    ],
  },
  {
    id: 'accounting-banking',
    label: 'Banking',
    type: 'header',
    items: [
      {
        id: 'accounting-banking-review',
        label: 'Review queue',
        slug: 'banking',
        icon: <Inbox />,
        description: 'Imported bank lines waiting to be coded or matched',
        keywords: ['bank feed', 'transactions', 'reconcile'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-deposits',
        label: 'Deposits',
        slug: 'banking/deposits',
        icon: <Landmark />,
        description: 'Group received payments into the one line the bank shows',
        keywords: ['undeposited funds', 'cheques', 'bank run', 'deposit slip'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-payouts',
        label: 'Payouts',
        slug: 'banking/payouts',
        icon: <Banknote />,
        description: 'Payouts and processor activity as the provider reported them',
        keywords: ['evidence', 'processor', 'unassigned', 'import issues'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-matches',
        label: 'Matches',
        slug: 'banking/matches',
        icon: <GitCompareArrows />,
        description: 'Payments and deposits in the connected books, matched against ours',
        keywords: ['quickbooks', 'duplicate', 'provider', 'suggested', 'adopt'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-settlements',
        label: 'Settlements',
        slug: 'banking/settlements',
        icon: <HandCoins />,
        description: 'What each rail settled into the bank, and what it relieved from clearing',
        keywords: ['settlement', 'clearing', 'processor fees', 'unidentified', 'rails'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-import',
        label: 'Import',
        slug: 'banking/import',
        icon: <FileUp />,
        description: 'Bring a bank statement in from a CSV, OFX, QFX or QBO file',
        keywords: ['statement', 'ofx', 'qbo', 'qfx', 'csv', 'upload', 'coverage gap'],
        permissionKey: 'ledger.post',
      },
      {
        id: 'accounting-banking-rules',
        label: 'Rules',
        slug: 'banking/rules',
        icon: <ListChecks />,
        description: 'Auto-suggest or auto-apply a category from a repeating pattern',
        keywords: ['bank rule', 'categorize', 'suggest', 'auto-apply'],
        permissionKey: 'ledger.post',
      },
    ],
  },
  {
    id: 'accounting-reports',
    label: 'Reports',
    type: 'header',
    items: [
      {
        id: 'accounting-reports-trial-balance',
        label: 'Trial balance',
        slug: 'reports/trial-balance',
        icon: <ListChecks />,
        description: 'Every account, debits and credits, ties to the books balance sweep',
      },
      {
        id: 'accounting-reports-balance-sheet',
        label: 'Balance sheet',
        slug: 'reports/balance-sheet',
        icon: <Scale />,
        description: 'Assets, liabilities and equity as of a date',
      },
      {
        id: 'accounting-reports-profit-and-loss',
        label: 'Profit and loss',
        slug: 'reports/profit-and-loss',
        icon: <TrendingUp />,
        description: 'Revenue and expense over a range',
      },
      {
        id: 'accounting-reports-general-ledger',
        label: 'General ledger',
        slug: 'reports/general-ledger',
        icon: <BookOpen />,
        description: 'Every posted line over a range, grouped by account',
      },
      {
        id: 'accounting-reports-ar-aging',
        label: 'A/R aging',
        slug: 'reports/ar-aging',
        icon: <Users />,
        description: 'Open receivables by contact, bucketed by age',
      },
      {
        id: 'accounting-reports-ap-aging',
        label: 'A/P aging',
        slug: 'reports/ap-aging',
        icon: <Building2 />,
        description: 'Open payables by vendor, bucketed by age',
      },
      {
        id: 'accounting-reports-vendor-1099',
        label: '1099 summary',
        slug: 'reports/vendor-1099',
        icon: <FileText />,
        description: 'Eligible vendors over the $600 filing threshold, boxed',
      },
    ],
  },
]

/**
 * Module header for `/app/accounting/*` — breadcrumb plus the two modes.
 *
 * ⚠️ TWO tabs, not the old four (81 §2): the rail says where you are inside the
 * work, so Ledger/Banking/Reports collapse into one `Accounting`. Settings stays
 * a tab because it is a different MODE with 23 rows and a rail of its own.
 *
 * `ledger.post`, not `ledger.control` — the segment holds General (period,
 * timezone, absorption rates, standard-cost roll), which is ordinary
 * bookkeeping; the chart, opening balances and bank accounts pages narrow
 * further on their own guards. ⚠️ Hiding it leaves one tab, and `MainPageTabs`
 * drops a one-tab switcher entirely — which is the wanted outcome.
 */
function AccountingLayoutHeader() {
  const { can } = useAccess()

  return (
    <MainPageHeader className='justify-start'>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem title='Accounting' href={BASE_URL} />
      </MainPageBreadcrumb>
      <MainPageTabs
        items={[
          {
            value: 'accounting',
            label: 'Accounting',
            icon: <Calculator />,
            href: BASE_URL,
            tooltip: 'Accounting',
          },
          {
            value: 'settings',
            // The SEGMENT, not a leaf: `MainPageTabs` matches longest-prefix, so
            // a leaf href would leave every sibling settings page matching only
            // `/app/accounting` and showing Accounting as active.
            label: 'Settings',
            icon: <Settings />,
            href: `${BASE_URL}/settings`,
            tooltip: 'Settings',
            hidden: !can('ledger.post'),
          },
        ]}
      />
    </MainPageHeader>
  )
}

/**
 * The module's one `MainPageContent`, one rail and one topbar (81 §6). The
 * content column hands `{children}` a DEFINITE height, which is what lets a page
 * own exactly one scroll area instead of measuring its way to one.
 */
function AccountingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const dockedPanels = useDockedPanelsOutlet()
  // The whole query string, not just `?month=`: the reports share a `?from=`/
  // `?to=` window that a bare link would reset, and a param the next route does
  // not read is inert there (the argument the deleted `reports/layout.tsx` made).
  const linkQuery = useSearchParams().toString()
  const current = pathname.startsWith(`${BASE_URL}/`) ? pathname.slice(BASE_URL.length + 1) : ''

  return (
    <MainPageContent dockedPanels={dockedPanels}>
      {/* `md:` must match `SidebarSecondary`'s own breakpoint — at `sm:` the rail
          is still in mobile-disclosure mode and collapses to a sliver. */}
      <SecondarySidebarProvider className='flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={ACCOUNTING_NAV}
          baseUrl={BASE_URL}
          current={current}
          title='Accounting'
          linkQuery={linkQuery}
        />
        <div className='flex h-full min-w-0 flex-1 flex-col overflow-hidden'>
          <AccountingToolbar />
          <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>{children}</div>
        </div>
      </SecondarySidebarProvider>
    </MainPageContent>
  )
}

/**
 * Module shell for `/app/accounting/*` (81-one-accounting-shell.md §2, §6).
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
  // Settings is the one segment that keeps its own `MainPageContent` and rail
  // (81 §2) — 23 rows and a different mode — so the shell steps aside for it
  // rather than nesting a second `MainPageContent` inside the first.
  const isSettings = pathname.startsWith(`${BASE_URL}/settings`)
  const permissionKey = isSettings ? 'ledger.post' : 'ledger.view'

  return (
    <CapabilityPageGuard permissionKey={permissionKey} area='Accounting'>
      <MainPage>
        <AccountingLayoutHeader />
        {isSettings ? (
          children
        ) : (
          <AccountingToolbarOutletProvider>
            <DockedPanelsOutletProvider>
              <AccountingShell>{children}</AccountingShell>
            </DockedPanelsOutletProvider>
          </AccountingToolbarOutletProvider>
        )}
        <AccountingSetupWizardGate />
      </MainPage>
    </CapabilityPageGuard>
  )
}
