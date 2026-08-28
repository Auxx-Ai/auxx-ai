// apps/web/src/app/(protected)/app/builds/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { usePathname } from 'next/navigation'
import { RecordRouteGuard } from '~/components/records'
import { useResource } from '~/components/resources'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/builds'

/**
 * Builds layout — the purchase-orders/orders recipe
 * (plans/products/build/01-build-plan.md §3.6): a plain breadcrumb shell for the
 * list route only. `RecordsView` (mounted by `builds/page.tsx`) renders its own
 * MainPageContent and contributes the Create button via `MainPageAction`; the
 * detail route (`[buildId]`) owns its own `MainPage` and bypasses the shell.
 *
 * There is no catch-all route for system entities, and the Records sidebar links
 * a system def as `/app/${apiSlug}`. This folder IS what makes entity migration
 * 110's `isVisible: true` lead somewhere instead of 404ing.
 */
export default function BuildsLayout({ children }: Props) {
  const pathname = usePathname()
  const { resource } = useResource('builds')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='builds'>
      {isDetailOrSpecialPage ? (
        <>{children}</>
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource?.plural ?? 'Builds'} href={BASE_PATH} />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
