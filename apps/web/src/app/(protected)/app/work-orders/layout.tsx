// apps/web/src/app/(protected)/app/work-orders/layout.tsx

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

const BASE_PATH = '/app/work-orders'

/**
 * Work orders layout — plain breadcrumb shell (no tabs; work orders has no
 * dashboard sub-route). `RecordsView` (mounted by `work-orders/page.tsx`)
 * renders its own MainPageContent and contributes the Create button via
 * `MainPageAction`. Detail (`[workOrderId]`) and import (`import/[jobId]`)
 * routes own their own `MainPage` and bypass the shell entirely.
 */
export default function WorkOrdersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { resource } = useResource('work-orders')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='work-orders'>
      {isDetailOrSpecialPage ? (
        children
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource?.plural ?? 'Work Orders'} href={BASE_PATH} />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
