// apps/web/src/app/(protected)/app/builds/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/builds'

/**
 * Builds layout, the companies recipe: the shared entity route shell
 * (List | Dashboard) for the list and dashboard routes only. `RecordsView`
 * (mounted by `builds/page.tsx`) renders its own `MainPageContent` and
 * contributes the Create button via `MainPageAction`. Detail (`[buildId]`)
 * and import routes own their own `MainPage` and bypass the shell.
 *
 * There is no catch-all route for system entities, and the Records sidebar links
 * a system def as `/app/${apiSlug}`. This folder IS what makes entity migration
 * 110's `isVisible: true` lead somewhere instead of 404ing.
 */
export default function BuildsLayout({ children }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug='builds' basePath={BASE_PATH}>
      {children}
    </EntityRouteLayout>
  )
}
