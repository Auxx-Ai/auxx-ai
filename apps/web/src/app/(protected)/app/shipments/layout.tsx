// apps/web/src/app/(protected)/app/shipments/layout.tsx

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

const BASE_PATH = '/app/shipments'

/**
 * Shipments layout, the credit-memos shell verbatim: a plain breadcrumb, no
 * tabs, drawer-only. `RecordsView` (mounted by `shipments/page.tsx`) renders
 * its own MainPageContent and contributes the Create button via
 * `MainPageAction`.
 *
 * There is no catch-all route for system entities, and the Records sidebar links
 * a system def as `/app/${apiSlug}`. This folder IS what makes the `shipment`
 * def's `sidebar: 'off'` entry lead somewhere instead of 404ing, once flipped
 * per `plans/entity/system-entity-behavior-map.md` §5.3.
 */
export default function ShipmentsLayout({ children }: Props) {
  const { resource } = useResource('shipments')

  return (
    <RecordRouteGuard slug='shipments'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Shipments'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
