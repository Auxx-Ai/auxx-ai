// apps/web/src/app/(protected)/app/orders/page.tsx

'use client'

import { RecordsView } from '~/components/records'

/**
 * Orders page — renders the shared RecordsView for the orders resource.
 *
 * The bulk fulfillment posting header action is gone (accounting migration
 * step 1b): every fulfillment posts as it ships now, so there is nothing left
 * to batch here. The Drafts tab (step 1c) is where a held draft gets reviewed.
 */
export default function OrdersPage() {
  return <RecordsView slug='orders' basePath='/app/orders' />
}
