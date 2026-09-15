// apps/web/src/app/(protected)/app/vendor-bills/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/vendor-bills'

/**
 * Vendor bills layout, the companies recipe: the shared entity route shell
 * (List | Dashboard) for the list and dashboard routes only. `[vendorBillId]`
 * (plans/money/tasks/58 §6.1) renders its own `MainPage` via `VendorBillPage`
 * and must bypass the shell, or two `MainPage` trees nest — same reason
 * `import/[jobId]` already does.
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
