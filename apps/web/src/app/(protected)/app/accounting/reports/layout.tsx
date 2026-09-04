// apps/web/src/app/(protected)/app/accounting/reports/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { Building2, FileText, ListChecks, Scale, TrendingUp, Users } from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Reports navigation (`plans/accounting/ui-plan.md` §1.2, §2.4): a
 * `SidebarSecondary`, the same idiom `accounting/settings/layout.tsx` uses.
 * Wave 1E shipped the three financial statements; wave 2H (this pass) adds
 * A/R aging, A/P aging and the 1099 summary on the same parts. Clearing
 * (2G phase C's payout report) stays a commented placeholder - left as code,
 * not a wired route, so the next agent finds the slot rather than
 * reinventing it.
 */
const REPORTS_NAV: SidebarProps[] = [
  {
    id: 'accounting-reports',
    label: 'Reports',
    type: 'header',
    items: [
      {
        id: 'accounting-reports-trial-balance',
        label: 'Trial balance',
        slug: 'trial-balance',
        icon: <ListChecks />,
        description: 'Every account, debits and credits, ties to the books balance sweep',
      },
      {
        id: 'accounting-reports-balance-sheet',
        label: 'Balance sheet',
        slug: 'balance-sheet',
        icon: <Scale />,
        description: 'Assets, liabilities and equity as of a date',
      },
      {
        id: 'accounting-reports-profit-and-loss',
        label: 'Profit and loss',
        slug: 'profit-and-loss',
        icon: <TrendingUp />,
        description: 'Revenue and expense over a range',
      },
      {
        id: 'accounting-reports-ar-aging',
        label: 'A/R aging',
        slug: 'ar-aging',
        icon: <Users />,
        description: 'Open receivables by contact, bucketed by age',
      },
      {
        id: 'accounting-reports-ap-aging',
        label: 'A/P aging',
        slug: 'ap-aging',
        icon: <Building2 />,
        description: 'Open payables by vendor, bucketed by age',
      },
      {
        id: 'accounting-reports-vendor-1099',
        label: '1099 summary',
        slug: 'vendor-1099',
        icon: <FileText />,
        description: 'Eligible vendors over the $600 filing threshold, boxed',
      },
      // Wave 2G phase C adds the payout clearing report (ui-plan.md §2.3):
      // {
      //   id: 'accounting-reports-clearing',
      //   label: 'Clearing',
      //   slug: 'clearing',
      //   icon: <ArrowLeftRight />,
      //   description: 'Shopify and processor clearing, one row per open payout',
      // },
    ],
  },
]

export default function AccountingReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]

  return (
    <MainPageContent>
      {/* `md:` must match `SidebarSecondary`'s own breakpoint - see
          `accounting/settings/layout.tsx` for why a mismatch collapses the
          sidebar to a sliver at `sm:`. */}
      <div className='flex h-full flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={REPORTS_NAV}
          baseUrl='/app/accounting/reports'
          current={page}
          title='Reports'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}
