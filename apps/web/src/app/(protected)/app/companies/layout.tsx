// apps/web/src/app/(protected)/app/companies/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode; modal: React.ReactNode }

const BASE_PATH = '/app/companies'

/**
 * Companies layout — entity route shell (List | Dashboard tabs) for the list
 * and dashboard pages. Detail (`[companyId]`) and import (`import/[jobId]`)
 * routes own their own `MainPage` (via `DetailView`/`ImportPage`) and bypass
 * the shell entirely.
 */
function CompaniesLayout({ children, modal }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return (
      <>
        {children}
        {modal}
      </>
    )
  }

  return (
    <EntityRouteLayout slug='companies' basePath={BASE_PATH}>
      {children}
      {modal}
    </EntityRouteLayout>
  )
}

export default CompaniesLayout
