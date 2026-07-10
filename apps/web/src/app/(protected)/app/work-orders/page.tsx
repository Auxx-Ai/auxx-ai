// apps/web/src/app/(protected)/app/work-orders/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Work orders page — renders the shared RecordsView for the work orders resource
 */
export default function WorkOrdersPage() {
  return <RecordsView slug='work-orders' basePath='/app/work-orders' />
}
