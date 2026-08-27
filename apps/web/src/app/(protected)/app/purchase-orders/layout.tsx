// apps/web/src/app/(protected)/app/purchase-orders/layout.tsx

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

const BASE_PATH = '/app/purchase-orders'

/**
 * Purchase orders layout — the orders/quotes recipe
 * (plans/purchasing/01-build-plan.md §4.4): a plain breadcrumb shell for the list
 * route only. `RecordsView` (mounted by `purchase-orders/page.tsx`) renders its
 * own MainPageContent and contributes the Create button via `MainPageAction`; the
 * detail route (`[purchaseOrderId]`) owns its own `MainPage` and bypasses the
 * shell entirely.
 */
export default function PurchaseOrdersLayout({ children }: Props) {
  const pathname = usePathname()
  const { resource } = useResource('purchase-orders')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='purchase-orders'>
      {isDetailOrSpecialPage ? (
        <>{children}</>
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem
                title={resource?.plural ?? 'Purchase Orders'}
                href={BASE_PATH}
              />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
