// apps/web/src/app/(protected)/app/tickets/layout.tsx

'use client'

import { Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

const BASE_PATH = '/app/tickets'

/**
 * Shared layout for tickets section with conditional rendering
 * - For tabbed pages (list, dashboard, settings): renders EntityRouteLayout with
 *   List | Dashboard | Settings tabs
 * - For detail/create/import pages: renders children only (they have their own layout)
 *
 * Note: TicketProvider has been removed - data is now managed by useRecordList
 */
export default function TicketsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Only the tabbed routes (list, dashboard, settings and their sub-pages) get the
  // shared shell. Everything else — detail, create, import — owns its own MainPage.
  const isTabbedPage =
    pathname === BASE_PATH ||
    pathname.startsWith(`${BASE_PATH}/dashboard`) ||
    pathname.startsWith(`${BASE_PATH}/settings`)

  if (!isTabbedPage) {
    return <>{children}</>
  }

  // For tabbed pages, render with the shared entity route shell
  return (
    <EntityRouteLayout
      slug='tickets'
      basePath={BASE_PATH}
      extraTabs={[
        { value: 'settings', label: 'Settings', icon: <Settings />, href: `${BASE_PATH}/settings` },
      ]}>
      {children}
    </EntityRouteLayout>
  )
}
