// apps/web/src/app/(protected)/app/invoices/layout.tsx

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

const BASE_PATH = '/app/invoices'

/**
 * Invoices layout — plain breadcrumb shell (no tabs; invoices has no
 * dashboard sub-route and is drawer-only, money MI1 build spec §J.6).
 * `RecordsView` (mounted by `invoices/page.tsx`) renders its own
 * MainPageContent and contributes the Create button via `MainPageAction`.
 * The import (`import/[jobId]`) route owns its own `MainPage` and bypasses
 * the shell.
 */
export default function InvoicesLayout({ children }: Props) {
  const pathname = usePathname()
  const { resource } = useResource('invoices')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='invoices'>
      {isDetailOrSpecialPage ? (
        <>{children}</>
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource?.plural ?? 'Invoices'} href={BASE_PATH} />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
