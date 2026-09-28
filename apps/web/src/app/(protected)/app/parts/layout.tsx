// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

const BASE_PATH = '/app/parts'

/**
 * Parts layout — the shared entity route shell (Parts | Dashboard).
 *
 * Only the tabbed routes get it. Detail (`[partId]`) and import
 * (`import/[jobId]`) render their own `MainPage` via `DetailView` / `ImportPage`
 * and must bypass this one, or two `MainPage` trees nest. Same guard as
 * `companies/layout.tsx`.
 *
 * `RecordsView` (mounted by `page.tsx`) renders its own `MainPageContent` and
 * contributes the Create button through `MainPageAction`.
 */
export default function PartsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isShellRoute = pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (!isShellRoute) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug='parts' basePath={BASE_PATH}>
      {children}
    </EntityRouteLayout>
  )
}
