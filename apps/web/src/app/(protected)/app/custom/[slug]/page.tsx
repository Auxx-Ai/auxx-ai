// apps/web/src/app/(protected)/app/custom/[slug]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { RecordsView } from '~/components/records'

/**
 * Custom entity records page — reads slug from URL params and passes to
 * RecordsView. The custom entity `layout.tsx` (EntityRouteLayout) owns the
 * MainPage shell.
 */
export default function CustomEntityRecordsPage() {
  const params = useParams<{ slug: string }>()
  return <RecordsView slug={params.slug} />
}
