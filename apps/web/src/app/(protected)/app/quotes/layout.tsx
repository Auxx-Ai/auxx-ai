// apps/web/src/app/(protected)/app/quotes/layout.tsx

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

const BASE_PATH = '/app/quotes'

/**
 * Quotes layout — plain breadcrumb shell (no tabs; quotes has no dashboard
 * sub-route). `RecordsView` (mounted by `quotes/page.tsx`) renders its own
 * MainPageContent and contributes the Create button via `MainPageAction`.
 * Detail (`[quoteId]`) and import (`import/[jobId]`) routes own their own
 * `MainPage` and bypass the shell entirely.
 */
export default function QuotesLayout({ children }: Props) {
  const pathname = usePathname()
  const { resource } = useResource('quotes')
  const isDetailOrSpecialPage = pathname !== BASE_PATH

  return (
    <RecordRouteGuard slug='quotes'>
      {isDetailOrSpecialPage ? (
        <>{children}</>
      ) : (
        <MainPage>
          <MainPageHeader>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource?.plural ?? 'Quotes'} href={BASE_PATH} />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {children}
        </MainPage>
      )}
    </RecordRouteGuard>
  )
}
