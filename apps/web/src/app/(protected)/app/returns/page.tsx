// apps/web/src/app/(protected)/app/returns/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Returns page, the shared RecordsView for the `returns` resource
 * (plans/money/tasks/54-returns.md section 3.1). Drawer-only, like credit
 * memos: there is no `[returnId]/` detail route, so opening a row opens the
 * drawer.
 *
 * The list page and the create dialog ARE the point here, unlike `shipment` /
 * `parcel` / `fulfillment`, which no person creates by hand. Three of the
 * feature's four intake routes end at this button: an email or a phone call
 * creates the return from the ticket drawer, and a pallet that turns up on the
 * dock with no warning is created here, from nothing, with `contact` still null.
 *
 * 🛑 No `pageActions`. The salvage writer is task 50-gated and there is no bulk
 * action to hang here yet; the per-return work happens in the drawer.
 */
export default function ReturnsPage() {
  return <RecordsView slug='returns' basePath='/app/returns' />
}
