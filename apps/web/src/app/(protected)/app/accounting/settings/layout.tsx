// apps/web/src/app/(protected)/app/accounting/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { Landmark, Scale, SlidersHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
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
    ],
  },
]

export default function AccountingSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]

  return (
    <MainPageContent>
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
