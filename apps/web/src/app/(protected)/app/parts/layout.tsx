// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'
import { useAccess } from '~/providers/capabilities-provider'

const BASE_PATH = '/app/parts'

/**
 * Parts layout — the shared entity route shell (Parts | Dashboard | Manage).
 *
 * Only the tabbed routes get it. Detail (`[partId]`) and import
 * (`import/[jobId]`) render their own `MainPage` via `DetailView` / `ImportPage`
 * and must bypass this one, or two `MainPage` trees nest. Same guard as
 * `companies/layout.tsx`, with the manage clause added.
 *
 * `RecordsView` (mounted by `page.tsx`) renders its own `MainPageContent` and
 * contributes the Create button through `MainPageAction`.
 */
export default function PartsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { can } = useAccess()

  const isShellRoute =
    pathname === BASE_PATH ||
    pathname.startsWith(`${BASE_PATH}/dashboard`) ||
    pathname.startsWith(`${BASE_PATH}/manage`)

  if (!isShellRoute) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout
      slug='parts'
      basePath={BASE_PATH}
      extraTabs={[
        {
          value: 'manage',
          label: 'Manage',
          icon: <Settings />,
          // The segment, never `manage/general`: `MainPageTabs` matches by
          // LONGEST PREFIX, so a leaf href makes every other manage page fall
          // through to the `/app/parts` prefix and light up the Parts tab.
          href: `${BASE_PATH}/manage`,
          // The segment holds the parts settings (`settingsManage`) and MRP
          // (`mrp.view`, whose `can()` also checks `FeatureKey.mrp`); the rail
          // hides whichever group the viewer cannot use. A hidden tab can
          // collapse the strip to one, which `MainPageTabs` drops, as intended.
          hidden: !can(PermissionKey.settingsManage) && !can(PermissionKey.mrpView),
        },
      ]}>
      {children}
    </EntityRouteLayout>
  )
}
