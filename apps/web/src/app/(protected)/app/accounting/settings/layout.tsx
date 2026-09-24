// apps/web/src/app/(protected)/app/accounting/settings/layout.tsx

'use client'

import { ACCOUNTING_PROVIDER_KEYWORDS } from '@auxx/lib/accounting/providers/client'
import { MainPageContent } from '@auxx/ui/components/main-page'
import {
  BookOpenCheck,
  Building2,
  CalendarClock,
  CreditCard,
  Landmark,
  Link2,
  Scale,
  SlidersHorizontal,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import {
  DockedPanelsOutletProvider,
  useDockedPanelsOutlet,
} from '~/components/global/docked-panels-outlet'
import { SecondarySidebarProvider } from '~/components/global/secondary-sidebar-provider'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Accounting settings navigation (13-accounting-ui.md §5.4).
 *
 * Costing folds into General: four sections in a two-column grid is exactly
 * `scheduling-settings-page.tsx`'s shape, so General is not overloaded.
 *
 * `Posting` sits between General and Connected system (brief 28 §3): it is
 * where the fulfillment mode and the payment routes moved to from General, and
 * the one page that says what posts, when, and what changes it.
 *
 * `Connected system` comes right after that, not last (brief 27 §2). Opening
 * balances reads the provider's trial balance and Accounts maps the provider's
 * chart - both presuppose a connection, and putting the connection after the
 * two pages that depend on it reads as an afterthought. It is still not a setup
 * gate: `setup-readiness.ts` has no provider requirement and `P1` makes
 * "nothing connected" first class.
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
        id: 'accounting-settings-posting',
        label: 'Posting',
        slug: 'posting',
        icon: <BookOpenCheck />,
        description: 'What posts to the ledger, when, and the settings that change it.',
        keywords: ['automatic', 'schedule', 'fulfillment', 'payout', 'routes', 'bulk'],
      },
      {
        id: 'accounting-settings-provider',
        label: 'Connected system',
        slug: 'provider',
        icon: <Link2 />,
        // The label stays vendor-agnostic; the keywords carry the vendor names people type.
        description: 'Connect an accounting system, compare balances, and bring in entries',
        keywords: [
          'xero',
          'sync',
          'reconcile',
          'agreement',
          'export',
          'provider',
          ...ACCOUNTING_PROVIDER_KEYWORDS,
        ],
      },
      {
        id: 'accounting-settings-opening',
        label: 'Opening balances',
        slug: 'opening',
        icon: <Scale />,
        description: 'The auxx and provider snapshots, and their reconciliation',
        keywords: ['cutover', 'baseline', ...ACCOUNTING_PROVIDER_KEYWORDS],
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
 * outlet rather than by passing a prop it cannot reach. The other five settings
 * pages publish nothing, so they keep getting an empty `dockedPanels` array.
 *
 * ⚠️ Settings keeps its OWN shell: `accounting/layout.tsx` renders bare children
 * under `/settings` so this `MainPageContent` is not nested inside its one
 * (`tasks/81` §10.1).
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
      <SecondarySidebarProvider className='flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={ACCOUNTING_SETTINGS}
          baseUrl='/app/accounting/settings'
          current={page}
          title='Settings'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </SecondarySidebarProvider>
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
