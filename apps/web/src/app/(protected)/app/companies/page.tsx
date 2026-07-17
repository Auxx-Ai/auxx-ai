// apps/web/src/app/(protected)/app/companies/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Companies page — renders the shared RecordsView for the companies resource.
 * The companies `layout.tsx` (EntityRouteLayout) owns the MainPage shell.
 */
export default function CompaniesPage() {
  return <RecordsView slug='companies' basePath='/app/companies' />
}
