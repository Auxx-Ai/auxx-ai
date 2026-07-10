// apps/web/src/app/(protected)/app/dispatch/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { Clock, FileText, Tags } from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Settings navigation items. Products & Services and Availability ship in
 * this slice — Workers and Number Formats arrive with the M2 dispatch board
 * build.
 */
const DISPATCH_SETTINGS: SidebarProps[] = [
  {
    id: 'dispatch-settings',
    label: 'Settings',
    type: 'header',
    items: [
      {
        id: 'dispatch-settings-products',
        label: 'Products & Services',
        slug: 'products',
        icon: <Tags />,
      },
      {
        id: 'dispatch-settings-availability',
        label: 'Availability',
        slug: 'availability',
        icon: <Clock />,
      },
      {
        id: 'dispatch-settings-documents',
        label: 'Documents',
        slug: 'documents',
        icon: <FileText />,
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
