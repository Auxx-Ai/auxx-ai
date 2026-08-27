// apps/web/src/app/(protected)/app/vendor-bills/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { RecordRouteGuard } from '~/components/records'
import { useResource } from '~/components/resources'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/vendor-bills'

/**
 * Vendor bills layout — the breadcrumb shell for the list route.
 *
 * Unlike `purchase-orders/layout.tsx` there is no detail-route escape hatch:
 * `vendor_bill` is drawer-only (plans/purchasing/01-build-plan.md §5.1), so this
 * segment has exactly one page and the shell always applies.
 */
export default function VendorBillsLayout({ children }: Props) {
  const { resource } = useResource('vendor-bills')

  return (
    <RecordRouteGuard slug='vendor-bills'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Vendor Bills'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
