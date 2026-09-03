// apps/web/src/app/(protected)/app/purchase-orders/page.tsx

'use client'

import { IntakeDraftAction } from '~/components/purchasing/intake/ui/intake-draft-action'
import { ReadQuoteButton } from '~/components/purchasing/intake/ui/read-quote-button'
import { RecordsView } from '~/components/records'

/**
 * Purchase orders page — renders the shared RecordsView for the
 * `purchase-orders` resource (plans/purchasing/01-build-plan.md §4.4).
 *
 * Plus the quote-intake entry point (plans/money/tasks/38 §6.1): a `pageActions`
 * button beside Create, and — for a draft this DEVICE started — a second header
 * action that portals itself into the same cluster. Both live on the header's one
 * line; neither adds a row above the table. The draft action reads a
 * `localStorage` pointer, so it is device-local by construction: there is no
 * `listDrafts` procedure and none should be built.
 */
export default function PurchaseOrdersPage() {
  return (
    <>
      <IntakeDraftAction />
      <RecordsView
        slug='purchase-orders'
        basePath='/app/purchase-orders'
        pageActions={<ReadQuoteButton />}
      />
    </>
  )
}
