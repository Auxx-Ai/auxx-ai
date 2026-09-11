// apps/web/src/app/(protected)/app/accounting/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import {
  Building2,
  CalendarClock,
  CreditCard,
  Landmark,
  Scale,
  SlidersHorizontal,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import {
  DockedPanelsOutletProvider,
  useDockedPanelsOutlet,
} from '~/components/global/docked-panels-outlet'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Accounting settings navigation (13-accounting-ui.md §5.4) — THREE pages, not
 * four. Costing folds into General: four sections in a two-column grid is
 * exactly `scheduling-settings-page.tsx`'s shape, so General is not overloaded.
 */
const ACCOUNTING_SETTINGS: SidebarProps[] = [
  {
    id: 'accounting-settings',
    label: 'Accounting',
    type: 'header',
    items: [
      {
        id: 'accounting-settings-general',
        label: 'General',
        slug: 'general',
        icon: <SlidersHorizontal />,
        description: 'Period, timezone, absorption rates and the standard-cost roll',
      },
      {
        id: 'accounting-settings-opening',
        label: 'Opening balances',
        slug: 'opening',
        icon: <Scale />,
        description: 'The auxx and QuickBooks snapshots, and their reconciliation',
        keywords: ['cutover', 'baseline', 'quickbooks'],
      },
      {
        id: 'accounting-settings-accounts',
        label: 'Accounts',
        slug: 'accounts',
        icon: <Landmark />,
        description: 'Map posting roles to accounts, and edit the chart',
        keywords: ['chart of accounts', 'roles', 'gl'],
      },
      {
        id: 'accounting-settings-bank-accounts',
        label: 'Bank accounts',
        slug: 'bank-accounts',
        icon: <Building2 />,
        description: 'Which chart account each bank account maps to, and its coverage',
        keywords: ['bank', 'feed', 'statement', 'reconcile'],
      },
      {
        id: 'accounting-settings-recurring',
        label: 'Recurring templates',
        slug: 'recurring',
        icon: <CalendarClock />,
        description: 'Entries that repeat, and the months they are still owed',
        keywords: ['depreciation', 'accrual', 'prepaid', 'schedule', 'template'],
      },
      {
        id: 'accounting-settings-payment-gateways',
        label: 'Payment gateways',
        slug: 'payment-gateways',
        icon: <CreditCard />,
        description: 'Which chart account each payment rail clears into',
        keywords: ['gateway', 'stripe', 'affirm', 'shopify payments', 'clearing'],
      },
    ],
  },
]

/**
 * The layout owns the one `MainPageContent`, so a page below it (Recurring
 * templates' journal-entry drawer) docks a panel by publishing it to the
 * outlet rather than by passing a prop it cannot reach — same reason
 * `accounting/banking/layout.tsx` does this. The other five settings pages
 * publish nothing, so they keep getting an empty `dockedPanels` array.
 */
function AccountingSettingsLayoutFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]
  const dockedPanels = useDockedPanelsOutlet()

  return (
    <MainPageContent dockedPanels={dockedPanels}>
      {/* `md:` must match SidebarSecondary's own breakpoint — at `sm:` the sidebar is
          still in mobile-disclosure mode with no fixed width and collapses to a sliver. */}
      <div className='flex flex-col md:flex-row h-full flex-1 overflow-hidden'>
        <SidebarSecondary
          items={ACCOUNTING_SETTINGS}
          baseUrl='/app/accounting/settings'
          current={page}
          title='Settings'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}

export default function AccountingSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <DockedPanelsOutletProvider>
      <AccountingSettingsLayoutFrame>{children}</AccountingSettingsLayoutFrame>
    </DockedPanelsOutletProvider>
  )
}
