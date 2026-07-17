// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Package } from 'lucide-react'
import { usePathname } from 'next/navigation'

/**
 * Parts layout — a plain breadcrumb shell (not an `EntityRouteLayout`; parts
 * has no Dashboard tab). `RecordsView` (mounted by `parts/page.tsx`) renders
 * its own MainPageContent and contributes the Create button via
 * `MainPageAction`.
 */
export default function PartsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Detail pages have their own MainPage wrapper via DetailView
  const isDetailPage =
    /\/parts\/[^/]+$/.test(pathname) &&
    !pathname.endsWith('/parts') &&
    !pathname.includes('/import')

  if (isDetailPage) {
    return <>{children}</>
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Parts'
            href='/app/parts'
            icon={<Package className='size-4' />}
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
