// apps/web/src/components/money/ui/order/order-fulfillment-ledger-card.helpers.ts

/**
 * Pure display logic for `order-fulfillment-ledger-card.tsx`, split out so it
 * can be unit tested without React, tRPC or a `'use client'` boundary.
 */

import type { Fulfillment, FulfillmentStatusValue } from '@auxx/lib/money/client'
import type { Variant as BadgeVariant } from '@auxx/ui/components/badge'

/** Format a fulfillment's `shippedAt` ISO instant for display. */
export function formatShippedAt(iso: string): string {
  if (!iso) return 'Unknown date'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

/**
 * Label and badge color for each `fulfillment_status` value. Shown only while
 * a fulfillment has not (yet) posted - see {@link fulfillmentBadge}.
 */
const STATUS_BADGES: Record<FulfillmentStatusValue, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'gray' },
  open: { label: 'In transit', variant: 'blue' },
  success: { label: 'Shipped', variant: 'green' },
  cancelled: { label: 'Cancelled', variant: 'red' },
  error: { label: 'Error', variant: 'red' },
  failure: { label: 'Failed', variant: 'red' },
}

/**
 * Which badge, if any, the ledger card shows on one fulfillment row.
 *
 * Priority order, and why:
 * 1. **Cancelled always wins.** A cancelled fulfillment is a real record now
 *    (entity migration 153), not an absence the connector filtered out -
 *    rendering it identically to a live shipment would hide that it never
 *    counted, and dropping the row would lose the one thing the JSON log
 *    never carried.
 * 2. **Reversed is next.** The row still names a real `GlPosting` - reversing
 *    is how a fulfillment posting is undone, never a delete - so this reads
 *    as "posted, then undone" rather than "never posted".
 * 3. **Everything else without a posting shows its channel status.** A
 *    fulfillment can exist (synced from the channel) before the nightly
 *    poster ever runs; without this a freshly-synced shipment would look
 *    identical to one that will never post.
 * 4. **A live, already-posted fulfillment shows no badge at all** - the doc
 *    number IS the status, exactly as it was before entity migration 153.
 */
export function fulfillmentBadge(
  fulfillment: Pick<Fulfillment, 'status' | 'glPosting'>,
  postingStatus: 'posted' | 'reversed' | undefined
): { label: string; variant: BadgeVariant } | null {
  if (fulfillment.status === 'cancelled') return STATUS_BADGES.cancelled
  if (postingStatus === 'reversed') return { label: 'Reversed', variant: 'amber' }
  if (!fulfillment.glPosting) return STATUS_BADGES[fulfillment.status]
  return null
}

/**
 * The tracking line shown in a row's trailing slot, or `undefined` when the
 * fulfillment carries no tracking number - most fulfillments marked shipped
 * without buying a label through a connected provider.
 */
export function trackingLabel(
  fulfillment: Pick<Fulfillment, 'trackingCompany' | 'trackingNumber'>
): string | undefined {
  if (!fulfillment.trackingNumber) return undefined
  return fulfillment.trackingCompany
    ? `${fulfillment.trackingCompany} · ${fulfillment.trackingNumber}`
    : fulfillment.trackingNumber
}
