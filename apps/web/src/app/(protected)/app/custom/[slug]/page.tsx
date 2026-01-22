// apps/web/src/app/(protected)/app/custom/[slug]/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Custom entity records page
 * Uses useResource internally for data fetching
 */
export default function CustomEntityRecordsPage() {
  return <RecordsView />
}
