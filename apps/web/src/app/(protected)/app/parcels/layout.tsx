// apps/web/src/app/(protected)/app/parcels/layout.tsx

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

const BASE_PATH = '/app/parcels'

/**
 * Parcels layout, the credit-memos shell verbatim: a plain breadcrumb, no
 * tabs, drawer-only. `RecordsView` (mounted by `parcels/page.tsx`) renders
 * its own MainPageContent and contributes the Create button via
 * `MainPageAction`.
 *
 * There is no catch-all route for system entities, and the Records sidebar links
 * a system def as `/app/${apiSlug}`. This folder IS what makes the `parcel`
 * def's `sidebar: 'off'` entry lead somewhere instead of 404ing, once flipped
 * per `plans/entity/system-entity-behavior-map.md` §5.3.
 */
export default function ParcelsLayout({ children }: Props) {
  const { resource } = useResource('parcels')

  return (
    <RecordRouteGuard slug='parcels'>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title={resource?.plural ?? 'Parcels'} href={BASE_PATH} />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {children}
      </MainPage>
    </RecordRouteGuard>
  )
}
