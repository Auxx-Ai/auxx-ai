// apps/web/src/app/(protected)/app/dispatch/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

/**
 * Module shell for `/app/dispatch/*` — `MainPage` chrome + header, mirroring
 * `tickets/layout.tsx`. Until the M2 board lands the module home redirects to
 * settings, so the header is breadcrumb-only; M2 adds the Board·Settings
 * RadioTab switcher and board actions here.
 */
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainPage>
      <MainPageHeader className='justify-start'>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Dispatch' href='/app/dispatch' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
