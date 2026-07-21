// apps/web/src/app/(protected)/app/dispatch/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import {
  Bell,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileText,
  Hash,
  Receipt,
  SlidersHorizontal,
  Tags,
  Users,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Settings navigation items (34-settings-reorg.md) — two header groups: org-wide "Settings"
 * and the money cluster ("Money"), one page per object (Quotes / Invoicing / Payments).
 */
const DISPATCH_SETTINGS: SidebarProps[] = [
  {
    id: 'dispatch-settings',
    label: 'Settings',
    type: 'header',
    items: [
      {
        id: 'dispatch-settings-general',
        label: 'General',
        slug: 'general',
        icon: <SlidersHorizontal />,
      },
      {
        id: 'dispatch-settings-scheduling',
        label: 'Scheduling',
        slug: 'scheduling',
        icon: <Clock />,
      },
      {
        id: 'dispatch-settings-workers',
        label: 'Workers',
        slug: 'workers',
        icon: <Users />,
      },
      {
        id: 'dispatch-settings-quality-checks',
        label: 'Quality checks',
        slug: 'quality-checks',
        icon: <ClipboardCheck />,
      },
      {
        id: 'dispatch-settings-client-notifications',
        label: 'Client notifications',
        slug: 'client-notifications',
        icon: <Bell />,
        featureKey: 'sequences',
      },
      {
        id: 'dispatch-settings-number-formats',
        label: 'Number Formats',
        slug: 'number-formats',
        icon: <Hash />,
      },
    ],
  },
  {
    id: 'dispatch-money',
    label: 'Money',
    type: 'header',
    items: [
      {
        id: 'dispatch-money-products',
        label: 'Products & Services',
        slug: 'products',
        icon: <Tags />,
      },
      {
        id: 'dispatch-money-quotes',
        label: 'Quotes',
        slug: 'quotes',
        icon: <FileText />,
      },
      {
        id: 'dispatch-money-invoicing',
        label: 'Invoicing',
        slug: 'invoicing',
        icon: <Receipt />,
      },
      {
        id: 'dispatch-money-payments',
        label: 'Payments',
        slug: 'payments',
        icon: <CreditCard />,
      },
    ],
  },
]

/**
 * Settings layout with secondary sidebar navigation — verbatim recipe from
 * `tickets/settings/layout.tsx`.
 */
export default function DispatchSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]

  const baseUrl = '/app/dispatch/settings'

  return (
    <MainPageContent>
      <div className='flex flex-col sm:flex-row h-full flex-1 overflow-hidden'>
        <SidebarSecondary
          items={DISPATCH_SETTINGS}
          baseUrl={baseUrl}
          current={page}
          title='Settings'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}
