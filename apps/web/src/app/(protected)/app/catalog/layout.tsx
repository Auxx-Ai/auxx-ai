// apps/web/src/app/(protected)/app/catalog/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tags } from 'lucide-react'

const BASE_PATH = '/app/catalog'

/** Pricing layout: a plain breadcrumb shell around catalog groups and tax rates (107 D9). */
export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Pricing'
            href={BASE_PATH}
            icon={<Tags className='size-4' />}
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
