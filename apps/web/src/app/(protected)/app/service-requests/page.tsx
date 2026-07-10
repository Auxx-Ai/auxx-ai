// apps/web/src/app/(protected)/app/service-requests/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Service requests page — renders the shared RecordsView for the service requests resource
 */
export default function ServiceRequestsPage() {
  return <RecordsView slug='service-requests' basePath='/app/service-requests' />
}
