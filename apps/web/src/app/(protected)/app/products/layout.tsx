// apps/web/src/app/(protected)/app/products/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Package2 } from 'lucide-react'
import { usePathname } from 'next/navigation'

const BASE_PATH = '/app/products'

/**
 * Products layout — the parts recipe: a plain breadcrumb shell for the list
 * route only. Detail pages (via DetailView) render their own MainPage.
 */
export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname !== BASE_PATH) {
    return <>{children}</>
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Products'
            href={BASE_PATH}
            icon={<Package2 className='size-4' />}
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
