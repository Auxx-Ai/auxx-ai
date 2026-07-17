// apps/web/src/components/schedule/ui/visit-detail-page.tsx
//
// Full-page shell for the visit detail route (08-worker-surface.md §3) — the mobile surface.
// On desktop the Schedule page opens the same content in `visit-drawer.tsx` instead. The
// breadcrumb's `getMyVisit` query dedupes with the one inside `VisitDetailContent`.

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { api } from '~/trpc/react'
import { VisitDetailContent } from './visit-detail-content'

interface VisitDetailPageProps {
  visitId: string
}

export function VisitDetailPage({ visitId }: VisitDetailPageProps) {
  const { data: visit } = api.dispatch.getMyVisit.useQuery({ visitId })

  const title = visit?.workOrder.displayName ?? visit?.workOrder.number ?? 'Visit'

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Schedule' href='/app/schedule' />
          <MainPageBreadcrumbItem title={title} />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <VisitDetailContent visitId={visitId} />
      </MainPageContent>
    </MainPage>
  )
}
