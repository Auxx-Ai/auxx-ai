// apps/web/src/app/(protected)/app/custom/[slug]/layout.tsx

'use client'

import { useParams, usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

/**
 * Custom entity layout — entity route shell (List | Dashboard tabs) for the
 * list and dashboard pages, one wiring for every custom entity def. Detail
 * (`[id]`) and import (`import/[jobId]`) routes own their own `MainPage`
 * (via `DetailView`/`ImportPage`) and bypass the shell entirely.
 */
function CustomEntityLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const pathname = usePathname()
  const basePath = `/app/custom/${slug}`
  const isDetailOrSpecialPage =
    pathname !== basePath && !pathname.startsWith(`${basePath}/dashboard`)

  if (isDetailOrSpecialPage) {
    return <>{children}</>
  }

  return (
    <EntityRouteLayout slug={slug} basePath={basePath}>
      {children}
    </EntityRouteLayout>
  )
}

export default CustomEntityLayout
