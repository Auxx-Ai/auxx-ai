// apps/web/src/app/(protected)/app/tickets/layout.tsx

'use client'

import { Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

/**
 * Shared layout for tickets section with conditional rendering
 * - For tabbed pages (list, dashboard, settings): renders EntityRouteLayout with
 *   List | Dashboard | Settings tabs
 * - For detail/create/import pages: renders children only (they have their own layout)
 *
 * Note: TicketProvider has been removed - data is now managed by useRecordList
 */
export default function TicketsLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  const pathname = usePathname()

  // Check if we're on a ticket detail page, create page, or import page
  // These pages have their own MainPage wrapper or don't need the tabbed header
  const isDetailOrSpecialPage =
    /\/tickets\/[^/]+$/.test(pathname) &&
    !pathname.endsWith('/tickets') &&
    !pathname.includes('/dashboard') &&
    !pathname.includes('/settings')

  // For detail/create/import pages, just render children (they have their own layout)
  if (isDetailOrSpecialPage) {
    return (
      <>
        {children}
        {modal}
      </>
    )
  }

  // For tabbed pages, render with the shared entity route shell
  return (
    <EntityRouteLayout
      slug='tickets'
      basePath='/app/tickets'
      extraTabs={[
        { value: 'settings', label: 'Settings', icon: <Settings />, href: '/app/tickets/settings' },
      ]}>
      {children}
      {modal}
    </EntityRouteLayout>
  )
}
