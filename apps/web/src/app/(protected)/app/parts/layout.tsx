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

const BASE_PATH = '/app/parts'

/**
 * Parts layout — a plain breadcrumb shell (not an `EntityRouteLayout`; parts
 * has no Dashboard tab). `RecordsView` (mounted by `parts/page.tsx`) renders
 * its own MainPageContent and contributes the Create button via
 * `MainPageAction`.
 */
export default function PartsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Detail pages (via DetailView) and import pages (via ImportPage) render their
  // own MainPage — only the list route gets this breadcrumb shell.
  if (pathname !== BASE_PATH) {
    return <>{children}</>
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Parts'
            href={BASE_PATH}
            icon={<Package className='size-4' />}
          />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
