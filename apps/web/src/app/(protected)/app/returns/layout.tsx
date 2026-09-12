// apps/web/src/app/(protected)/app/returns/layout.tsx

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

const BASE_PATH = '/app/returns'

/**
 * Returns layout, the credit-memos shell verbatim: a plain breadcrumb, no tabs,
 * drawer-only. `RecordsView` (mounted by `returns/page.tsx`) renders its own
 * MainPageContent and contributes the Create button via `MainPageAction`.
 *
 * `return` is the one definition in this feature with a route folder at all.
 * `return_line` and `return_part_line` are hidden and managed entirely from the
 * parent, because warehouse staff create a return by hand but never a line
 * directly (plans/money/tasks/54-returns.md section 3.1).
 */
export default function ReturnsLayout({ children }: Props) {
  const { resource } = useResource('returns')

  return (
    <RecordRouteGuard slug='returns'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Returns'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
