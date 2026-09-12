// packages/lib/src/money/fulfillments/client.ts

/**
 * The client-safe half of the fulfillment records module: the record shapes
 * and the pure functions over them.
 *
 * Deliberately NO `'use client'` directive: server code imports this file too
 * (`money/orders/client.ts` re-bases its own pure functions on
 * {@link Fulfillment}), and the directive would turn every export into a
 * client-reference proxy there (`docs/lib-module-guide.md` §7).
 */

export type { RecordId } from '@auxx/types/resource'
export {
  type CreatedFulfillment,
  type CreateFulfillmentInput,
  type CreateFulfillmentLineInput,
  FULFILLMENT_STATUSES,
  type Fulfillment,
  type FulfillmentLine,
  type FulfillmentPostingStamp,
  type FulfillmentStatusValue,
} from './types'

import type { Fulfillment } from './types'

/**
 * The display name a fulfillment gets when nothing was projected to fill it.
 *
 * `computeDisplayValue` reads `fulfillment_name` on the ROW and has no
 * fallback (registry field docblock) - a fulfillment with an empty name
 * renders nameless, exactly the defect the shipment proposal hit on
 * `shipment_number`. The connector projects Shopify's own `name` when it has
 * one; the native door (`money/orders/fulfill.ts`) calls this instead.
 */
export function defaultFulfillmentName(orderNumber: string | null, sequence: number): string {
  return orderNumber ? `${orderNumber}-F${sequence}` : `Shipment ${sequence}`
}

/**
 * Whether a fulfillment is live for revenue/relief purposes - everything but
 * `cancelled`.
 *
 * 🛑 Not used to filter {@link shippedByLine} or {@link Fulfillment} totals
 * today - brief §9 item 2 leaves "does a cancelled fulfillment reverse relief
 * automatically" an open decision for task 50. This exists so a future caller
 * that DOES need the distinction has one definition rather than five inline
 * `!== 'cancelled'` checks.
 */
export function isLiveFulfillment(fulfillment: Pick<Fulfillment, 'status'>): boolean {
  return fulfillment.status !== 'cancelled'
}
