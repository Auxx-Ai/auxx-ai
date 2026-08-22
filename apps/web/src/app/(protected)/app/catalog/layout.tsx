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

/**
 * Catalog layout — the products-route recipe: a plain breadcrumb shell around
 * the catalog surface (plans/products/01-product-family.md §6).
 */
export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Catalog'
            href={BASE_PATH}
            icon={<Tags className='size-4' />}
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
