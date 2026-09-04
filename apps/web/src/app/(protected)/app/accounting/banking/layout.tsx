// apps/web/src/app/(protected)/app/accounting/banking/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { FileUp, Inbox, Landmark, ListChecks } from 'lucide-react'
import { usePathname } from 'next/navigation'
import {
  DockedPanelsOutletProvider,
  useDockedPanelsOutlet,
} from '~/components/global/docked-panels-outlet'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Accounting > Banking navigation (plans/accounting/ui-plan.md §2.6).
 *
 * A `SidebarSecondary` in the same shape as `settings/layout.tsx`, and for the
 * same reason: Banking is one header TAB with several pages under it, not
 * several tabs. The bank feed is a later wave, so today the review queue is a
 * placeholder and Deposits is the page that does something - the entry is here
 * anyway because it is where a bank line will arrive, and grouping only makes
 * sense once a reader can see what it is grouping FOR.
 */
const ACCOUNTING_BANKING: SidebarProps[] = [
  {
    id: 'accounting-banking',
    label: 'Banking',
    type: 'header',
    items: [
      {
        id: 'accounting-banking-review',
        label: 'Review queue',
        slug: '',
        icon: <Inbox />,
        description: 'Imported bank lines waiting to be coded or matched',
        keywords: ['bank feed', 'transactions', 'reconcile'],
      },
      {
        id: 'accounting-banking-deposits',
        label: 'Deposits',
        slug: 'deposits',
        icon: <Landmark />,
        description: 'Group received payments into the one line the bank shows',
        keywords: ['undeposited funds', 'cheques', 'bank run', 'deposit slip'],
      },
      {
        // Slot 3D. The ingest path a vendor cannot switch off: the API reaches
        // back 180 days, some institutions are not covered at all, and a dead
        // feed mid-close still has to be finished.
        id: 'accounting-banking-import',
        label: 'Import',
        slug: 'import',
        icon: <FileUp />,
        description: 'Bring a bank statement in from a CSV, OFX, QFX or QBO file',
        keywords: ['statement', 'ofx', 'qbo', 'qfx', 'csv', 'upload', 'coverage gap'],
      },
      {
        id: 'accounting-banking-rules',
        label: 'Rules',
        slug: 'rules',
        icon: <ListChecks />,
        description: 'Auto-suggest or auto-apply a category from a repeating pattern',
        keywords: ['bank rule', 'categorize', 'suggest', 'auto-apply'],
      },
    ],
  },
]

/**
 * The layout owns the one `MainPageContent`, so a page below it docks a detail
 * panel by publishing it to the outlet rather than by passing a prop it cannot
 * reach. See `docked-panels-outlet.tsx`.
 */
function BankingLayoutFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // The review queue is the SEGMENT root, so its slug is the empty string and
  // the last path segment on that route is `banking` itself.
  const page = pathname.endsWith('/banking') ? '' : (pathname.split('/').pop() ?? '')
  const dockedPanels = useDockedPanelsOutlet()

  return (
    <MainPageContent dockedPanels={dockedPanels}>
      {/* `md:` must match SidebarSecondary's own breakpoint - at `sm:` the
          sidebar is still in mobile-disclosure mode with no fixed width and
          collapses to a sliver. */}
      <div className='flex h-full flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={ACCOUNTING_BANKING}
          baseUrl='/app/accounting/banking'
          current={page}
          title='Banking'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}

export default function AccountingBankingLayout({ children }: { children: React.ReactNode }) {
  return (
    <DockedPanelsOutletProvider>
      <BankingLayoutFrame>{children}</BankingLayoutFrame>
    </DockedPanelsOutletProvider>
  )
}
