// apps/web/src/app/(protected)/app/orders/page.tsx

'use client'

import { PostFulfillmentsButton } from '~/components/money/ui/fulfillment-posting'
import { RecordsView } from '~/components/records'

/**
 * Orders page — renders the shared RecordsView for the orders resource.
 *
 * The `pageActions` button is the bulk fulfillment posting's entry point
 * (plans/money/tasks/49-bulk-fulfillment-posting.md §2.3), following the builds
 * page's `BackfillBuildsButton` precedent: one header action beside Create, no
 * extra row above the table. It renders nothing without `ledger.post`.
 */
export default function OrdersPage() {
  return (
    <RecordsView slug='orders' basePath='/app/orders' pageActions={<PostFulfillmentsButton />} />
  )
}
