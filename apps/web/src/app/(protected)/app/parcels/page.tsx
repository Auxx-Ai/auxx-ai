// apps/web/src/app/(protected)/app/parcels/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Parcels page, the shared RecordsView for the `parcels` resource.
 * Drawer-only, like credit-memos: there is no `[parcelId]/` detail route, so
 * opening a row opens the drawer.
 *
 * A parcel's display value IS its tracking number, which is why `parcel` is
 * deliberately excluded from the global search corpus
 * (plans/entity/system-entity-behavior-map.md §6) while still being reachable
 * here and through its shipment's relationship field.
 */
export default function ParcelsPage() {
  return <RecordsView slug='parcels' basePath='/app/parcels' />
}
