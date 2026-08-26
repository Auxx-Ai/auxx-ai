// apps/web/src/app/(protected)/app/orders/layout.tsx

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

const BASE_PATH = '/app/orders'

/**
 * Orders layout — the quotes recipe (plans/products/08-order-build.md §5.7/§5.8,
 * D17): a plain breadcrumb shell for the list route only. `RecordsView` (mounted
 * by `orders/page.tsx`) renders its own MainPageContent and contributes the
 * Create button via `MainPageAction`; the detail route (`[orderId]`) owns its own
 * `MainPage` and bypasses the shell entirely.
 */
export default function OrdersLayout({ children }: Props) {
  const pathname = usePathname()
  const { resource } = useResource('orders')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='orders'>
      {isDetailOrSpecialPage ? (
        <>{children}</>
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource?.plural ?? 'Orders'} href={BASE_PATH} />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
