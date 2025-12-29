// apps/web/src/app/(protected)/app/custom/[slug]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { EntityRecordsProvider } from '~/components/custom-fields/context/entity-records-context'
import { EntityRecordsContent } from './_components/entity-records-content'

/**
 * Custom entity records page
 * Wraps content with EntityRecordsProvider for centralized data fetching
 */
export default function CustomEntityRecordsPage() {
  const params = useParams<{ slug: string }>()

  return (
    <EntityRecordsProvider slug={params.slug}>
      <EntityRecordsContent />
    </EntityRecordsProvider>
  )
}
