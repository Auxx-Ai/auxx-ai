// apps/web/src/app/(protected)/app/vendor-credits/layout.tsx

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

const BASE_PATH = '/app/vendor-credits'

/**
 * Vendor credits layout, the credit-memos shell verbatim: a plain breadcrumb, no
 * tabs, drawer-only. `RecordsView` (mounted by `vendor-credits/page.tsx`) renders
 * its own MainPageContent and contributes the Create button via `MainPageAction`.
 */
export default function VendorCreditsLayout({ children }: Props) {
  const { resource } = useResource('vendor-credits')

  return (
    <RecordRouteGuard slug='vendor-credits'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Vendor Credits'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
