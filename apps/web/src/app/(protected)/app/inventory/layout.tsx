// apps/web/src/app/(protected)/app/inventory/layout.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageAction,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
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
import {
  INVENTORY_BASE_URL,
  INVENTORY_NAV,
  INVENTORY_PLANNING_SLUGS,
} from '~/components/mrp/inventory-nav'
import { MrpGuideDialog } from '~/components/mrp/ui/mrp-guide-dialog'
import { MrpRunNowButton } from '~/components/mrp/ui/mrp-toolbar-actions'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * The accounting shell (plans/mrp/07-ui-plan.md §3): one `MainPageContent`, one
 * rail, one toolbar, and a definite height for the page.
 */
function InventoryShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const dockedPanels = useDockedPanelsOutlet()
  const { can } = useAccess()
  // Only `?run=` rides a rail click: a page's own params (`?s=`, `?part=`) mean nothing next door.
  const run = useSearchParams().get('run')
  const linkQuery = run ? new URLSearchParams({ run }).toString() : undefined
  const current = pathname.startsWith(`${INVENTORY_BASE_URL}/`)
    ? pathname.slice(INVENTORY_BASE_URL.length + 1)
    : ''

  return (
    <MainPageContent dockedPanels={dockedPanels}>
      {/* In the layout, not the pages, so the watch's polling survives a rail jump. */}
      {INVENTORY_PLANNING_SLUGS.has(current) && can(PermissionKey.mrpManage) && (
        <MainPageAction>
          <MrpRunNowButton variant='outline' className='h-7 rounded-lg' watch />
        </MainPageAction>
      )}
      {/* `md:` must match `SidebarSecondary`'s own breakpoint. */}
      <SecondarySidebarProvider className='flex-1 flex-col overflow-hidden md:flex-row'>
        <SidebarSecondary
          items={INVENTORY_NAV}
          baseUrl={INVENTORY_BASE_URL}
          current={current}
          title='Inventory'
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
 * Inventory: MRP and the parts settings. The guard is `settingsManage` OR
 * `mrp.view`; each page narrows further on its own, and the `mrp` router asserts
 * `FeatureKey.mrp` server-side.
 */
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const { can } = useAccess()
  // `CapabilityPageGuard` takes one key; asking for whichever the viewer holds makes it an OR.
  const permissionKey = can(PermissionKey.settingsManage)
    ? PermissionKey.settingsManage
    : PermissionKey.mrpView

  return (
    <CapabilityPageGuard permissionKey={permissionKey} area='Inventory'>
      <MainPage>
        <MainPageHeader className='justify-start'>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Inventory' href={INVENTORY_BASE_URL} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <ModuleToolbarOutletProvider>
          <DockedPanelsOutletProvider>
            <InventoryShell>{children}</InventoryShell>
          </DockedPanelsOutletProvider>
        </ModuleToolbarOutletProvider>
      </MainPage>
    </CapabilityPageGuard>
  )
}
