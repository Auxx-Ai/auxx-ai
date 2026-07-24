// apps/web/src/app/(protected)/app/dispatch/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import { CalendarDays, Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { DispatchSetupWizardGate } from '~/components/dispatch/ui/setup-wizard/setup-wizard-gate'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * Module header for `/app/dispatch/*` — Board · Settings tabs via
 * `MainPageTabs` in route mode (active tab derived from the pathname,
 * `router.push` on select).
 */
function DispatchLayoutHeader() {
  const { can } = useAccess()

  return (
    <MainPageHeader className='justify-start'>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem title='Dispatch' href='/app/dispatch' />
      </MainPageBreadcrumb>
      <MainPageTabs
        items={[
          {
            value: 'board',
            label: 'Board',
            icon: <CalendarDays />,
            href: '/app/dispatch',
            tooltip: 'Board',
          },
          {
            value: 'settings',
            label: 'Settings',
            icon: <Settings />,
            href: '/app/dispatch/settings',
            tooltip: 'Settings',
            hidden: !can('dispatch.board.manage'),
          },
        ]}
      />
    </MainPageHeader>
  )
}

/**
 * Module shell for `/app/dispatch/*` — `MainPage` chrome + the Board·Settings
 * header (M2a, 07-m2-build.md §D.1). The board is the module home now; the
 * settings sub-tree (`dispatch/settings/*`) keeps its own secondary sidebar
 * layout untouched. `DispatchSetupWizardGate` (32-onboarding.md Part C) mounts
 * here so the setup wizard can auto-open on first visit anywhere under this
 * route tree; it renders nothing until its own gating conditions are met.
 */
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isSettings = pathname.startsWith('/app/dispatch/settings')
  const permissionKey = isSettings ? 'dispatch.board.manage' : 'dispatch.board.view'

  return (
    <CapabilityPageGuard permissionKey={permissionKey} area='Dispatch'>
      <MainPage>
        <DispatchLayoutHeader />
        {children}
        <DispatchSetupWizardGate />
      </MainPage>
    </CapabilityPageGuard>
  )
}
