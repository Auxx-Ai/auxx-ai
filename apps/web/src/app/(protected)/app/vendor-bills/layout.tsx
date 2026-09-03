// apps/web/src/app/(protected)/app/vendor-bills/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/vendor-bills'

/**
 * Vendor bills layout, the companies recipe: the shared entity route shell
 * (List | Dashboard) for the list and dashboard routes only. `vendor_bill` is
 * drawer-only (plans/purchasing/01-build-plan.md §5.1) so there is no detail
 * route, but `import/[jobId]` renders its own `MainPage` via `ImportPage`
 * and must bypass the shell, or two `MainPage` trees nest.
 */
export default function VendorBillsLayout({ children }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug='vendor-bills' basePath={BASE_PATH}>
      {children}
    </EntityRouteLayout>
  )
}
