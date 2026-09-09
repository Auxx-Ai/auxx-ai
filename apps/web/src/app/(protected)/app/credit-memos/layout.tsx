// apps/web/src/app/(protected)/app/credit-memos/layout.tsx

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

const BASE_PATH = '/app/credit-memos'

/**
 * Credit memos layout, the invoices shell verbatim: a plain breadcrumb, no
 * tabs, drawer-only. `RecordsView` (mounted by `credit-memos/page.tsx`)
 * renders its own MainPageContent and contributes the Create button via
 * `MainPageAction`.
 */
export default function CreditMemosLayout({ children }: Props) {
  const { resource } = useResource('credit-memos')

  return (
    <RecordRouteGuard slug='credit-memos'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Credit Memos'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
