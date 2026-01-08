// apps/web/src/app/(protected)/app/custom/[slug]/page.tsx
'use client'

import { EntityRecordsContent } from './_components/entity-records-content'

/**
 * Custom entity records page
 * Uses useResource internally for data fetching
 */
export default function CustomEntityRecordsPage() {
  return <EntityRecordsContent />
}
