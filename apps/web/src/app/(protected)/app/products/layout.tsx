// apps/web/src/app/(protected)/app/products/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode }

const BASE_PATH = '/app/products'

/**
 * Products layout, the companies recipe: the shared entity route shell
 * (List | Dashboard) for the list and dashboard routes only. Detail
 * (`[productId]`) and import routes own their own `MainPage` via
 * `DetailView` / `ImportPage` and bypass the shell.
 */
export default function ProductsLayout({ children }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug='products' basePath={BASE_PATH}>
      {children}
    </EntityRouteLayout>
  )
}
