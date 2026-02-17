// apps/web/src/app/(protected)/app/custom/[slug]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { RecordsView } from '~/components/records'

/**
 * Custom entity records page
 * Reads slug from URL params and passes to RecordsView
 */
export default function CustomEntityRecordsPage() {
  const params = useParams<{ slug: string }>()
  return <RecordsView slug={params.slug} />
}
