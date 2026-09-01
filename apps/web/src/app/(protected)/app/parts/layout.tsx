// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Settings } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'
import { useAccess } from '~/providers/capabilities-provider'

const BASE_PATH = '/app/parts'

/**
 * Parts layout — the shared entity route shell (Parts | Dashboard | Settings).
 *
 * Only the tabbed routes get it. Detail (`[partId]`) and import
 * (`import/[jobId]`) render their own `MainPage` via `DetailView` / `ImportPage`
 * and must bypass this one, or two `MainPage` trees nest. Same guard as
 * `companies/layout.tsx`, with the settings clause added.
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
    pathname.startsWith(`${BASE_PATH}/settings`)

  if (!isShellRoute) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout
      slug='parts'
      basePath={BASE_PATH}
      extraTabs={[
        {
          value: 'settings',
          label: 'Settings',
          icon: <Settings />,
          // The segment, never `settings/general`: `MainPageTabs` matches by
          // LONGEST PREFIX, so a leaf href makes every other settings page fall
          // through to the `/app/parts` prefix and light up the Parts tab.
          href: `${BASE_PATH}/settings`,
          // Mirrors what the page and the mutation both assert. Hiding it can
          // collapse the strip to a single tab, at which point `MainPageTabs`
          // drops the whole control — that is intended, not a bug to patch.
          hidden: !can(PermissionKey.settingsManage),
        },
      ]}>
      {children}
    </EntityRouteLayout>
  )
}
