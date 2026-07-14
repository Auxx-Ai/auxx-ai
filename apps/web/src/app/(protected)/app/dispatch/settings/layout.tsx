// apps/web/src/app/(protected)/app/dispatch/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import {
  ClipboardCheck,
  Clock,
  CreditCard,
  FileText,
  Hash,
  Receipt,
  Tags,
  Users,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/** Settings navigation items (04-ui.md §9). */
const DISPATCH_SETTINGS: SidebarProps[] = [
  {
    id: 'dispatch-settings',
    label: 'Settings',
    type: 'header',
    items: [
      {
        id: 'dispatch-settings-workers',
        label: 'Workers',
        slug: 'workers',
        icon: <Users />,
      },
      {
        id: 'dispatch-settings-products',
        label: 'Products & Services',
        slug: 'products',
        icon: <Tags />,
      },
      {
        id: 'dispatch-settings-number-formats',
        label: 'Number Formats',
        slug: 'number-formats',
        icon: <Hash />,
      },
      {
        id: 'dispatch-settings-availability',
        label: 'Availability',
        slug: 'availability',
        icon: <Clock />,
      },
      {
        id: 'dispatch-settings-quality-checks',
        label: 'Quality checks',
        slug: 'quality-checks',
        icon: <ClipboardCheck />,
      },
      {
        id: 'dispatch-settings-documents',
        label: 'Documents',
        slug: 'documents',
        icon: <FileText />,
      },
      {
        id: 'dispatch-settings-invoicing',
        label: 'Invoicing & Quoting',
        slug: 'invoicing',
        icon: <Receipt />,
      },
      {
        id: 'dispatch-settings-payments',
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
