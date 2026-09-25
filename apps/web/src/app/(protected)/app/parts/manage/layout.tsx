// apps/web/src/app/(protected)/app/parts/manage/layout.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { usePathname, useSearchParams } from 'next/navigation'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import {
  DockedPanelsOutletProvider,
  useDockedPanelsOutlet,
} from '~/components/global/docked-panels-outlet'
import { ModuleToolbar } from '~/components/global/module-toolbar'
import { ModuleToolbarOutletProvider } from '~/components/global/module-toolbar-outlet'
import { SecondarySidebarProvider } from '~/components/global/secondary-sidebar-provider'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import { MANAGE_BASE_URL, MANAGE_NAV } from '~/components/mrp/manage-nav'
import { MrpGuideDialog } from '~/components/mrp/ui/mrp-guide-dialog'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * The accounting shell without its header (plans/mrp/07-ui-plan.md §3): one
 * `MainPageContent`, one rail, one toolbar, and a definite height for the page.
 */
function ManageShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const dockedPanels = useDockedPanelsOutlet()
  // Only `?run=` rides a rail click: a page's own params (`?s=`, `?part=`) mean nothing next door.
  const run = useSearchParams().get('run')
  const linkQuery = run ? new URLSearchParams({ run }).toString() : undefined
  const current = pathname.startsWith(`${MANAGE_BASE_URL}/`)
    ? pathname.slice(MANAGE_BASE_URL.length + 1)
    : ''

  return (
    <MainPageContent dockedPanels={dockedPanels}>
      {/* `md:` must match `SidebarSecondary`'s own breakpoint. */}
      <SecondarySidebarProvider className='flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={MANAGE_NAV}
          baseUrl={MANAGE_BASE_URL}
          current={current}
          title='Manage'
          linkQuery={linkQuery}
        />
        <div className='flex h-full min-w-0 flex-1 flex-col overflow-hidden'>
          <ModuleToolbar
            helpLabel='How the plan works'
            helpDialog={(p) => <MrpGuideDialog {...p} />}
          />
          <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>{children}</div>
        </div>
      </SecondarySidebarProvider>
    </MainPageContent>
  )
}

/**
 * Parts > Manage: the parts settings and MRP. The guard is `settingsManage` OR
 * `mrp.view`; each page narrows further on its own, and the `mrp` router asserts
 * `FeatureKey.mrp` server-side.
 */
export default function ManageLayout({ children }: { children: React.ReactNode }) {
  const { can } = useAccess()
  // `CapabilityPageGuard` takes one key; asking for whichever the viewer holds makes it an OR.
  const permissionKey = can(PermissionKey.settingsManage)
    ? PermissionKey.settingsManage
    : PermissionKey.mrpView

  return (
    <CapabilityPageGuard permissionKey={permissionKey} area='Manage'>
      <ModuleToolbarOutletProvider>
        <DockedPanelsOutletProvider>
          <ManageShell>{children}</ManageShell>
        </DockedPanelsOutletProvider>
      </ModuleToolbarOutletProvider>
    </CapabilityPageGuard>
  )
}
