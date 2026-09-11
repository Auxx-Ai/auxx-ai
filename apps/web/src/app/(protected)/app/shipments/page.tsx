// apps/web/src/app/(protected)/app/shipments/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Shipments page, the shared RecordsView for the `shipments` resource.
 * Drawer-only, like credit-memos: there is no `[shipmentId]/` detail route,
 * so opening a row opens the drawer.
 *
 * The display field is `shipment_master_tracking_number`, NOT
 * `shipment_number`: it is denormalized off the active label's master by the
 * connector, because `computeDisplayValue` reads a field on the row and a
 * tracking number otherwise lives only on a `parcel`.
 * Source: plans/apps/shipstation/shared-shipment-entities-proposal.md §10.
 */
export default function ShipmentsPage() {
  return <RecordsView slug='shipments' basePath='/app/shipments' />
}
