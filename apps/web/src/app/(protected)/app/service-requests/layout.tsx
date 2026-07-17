// apps/web/src/app/(protected)/app/service-requests/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { usePathname } from 'next/navigation'
import { useResource } from '~/components/resources'

const BASE_PATH = '/app/service-requests'

/**
 * Service requests layout — plain breadcrumb shell (no tabs; service
 * requests has no dashboard sub-route). `RecordsView` (mounted by
 * `service-requests/page.tsx`) renders its own MainPageContent and
 * contributes the Create button via `MainPageAction`. The import
 * (`import/[jobId]`) route owns its own `MainPage` and bypasses the shell.
 */
export default function ServiceRequestsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { resource } = useResource('service-requests')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={resource?.plural ?? 'Service Requests'} href={BASE_PATH} />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
