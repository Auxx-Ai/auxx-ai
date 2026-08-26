// apps/web/src/app/(protected)/app/orders/page.tsx

'use client'

import { RecordsView } from '~/components/records'

/**
 * Orders page — renders the shared RecordsView for the orders resource.
 */
export default function OrdersPage() {
  return <RecordsView slug='orders' basePath='/app/orders' />
}
