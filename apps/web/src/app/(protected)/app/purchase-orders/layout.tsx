// apps/web/src/app/(protected)/app/purchase-orders/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/purchase-orders'

/**
 * Purchase orders layout, the companies recipe: the shared entity route shell
 * (List | Dashboard) for the list and dashboard routes only. `RecordsView`
 * (mounted by `purchase-orders/page.tsx`) renders its own `MainPageContent`
 * and contributes the Create button via `MainPageAction`. Detail
 * (`[purchaseOrderId]`), intake and import routes own their own `MainPage`
 * and bypass the shell, or two `MainPage` trees nest.
 */
export default function PurchaseOrdersLayout({ children }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug='purchase-orders' basePath={BASE_PATH}>
      {children}
    </EntityRouteLayout>
  )
}
