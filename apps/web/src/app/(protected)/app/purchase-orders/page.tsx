// apps/web/src/app/(protected)/app/purchase-orders/page.tsx

'use client'

import { IntakeDraftBanner } from '~/components/purchasing/intake/ui/intake-draft-banner'
import { ReadQuoteButton } from '~/components/purchasing/intake/ui/read-quote-button'
import { RecordsView } from '~/components/records'

/**
 * Purchase orders page — renders the shared RecordsView for the
 * `purchase-orders` resource (plans/purchasing/01-build-plan.md §4.4).
 *
 * Plus the quote-intake entry point (plans/money/tasks/38 §6.1): a `pageActions`
 * button beside Create, and a slim banner for a draft this DEVICE started. The
 * banner reads a `localStorage` pointer — there is no `listDrafts` procedure and
 * none should be built, so the banner is device-local by construction.
 */
export default function PurchaseOrdersPage() {
  return (
    <>
      <IntakeDraftBanner />
      <RecordsView
        slug='purchase-orders'
        basePath='/app/purchase-orders'
        pageActions={<ReadQuoteButton />}
      />
    </>
  )
}
