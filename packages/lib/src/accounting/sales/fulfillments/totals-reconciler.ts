// packages/lib/src/accounting/sales/fulfillments/totals-reconciler.ts

/**
 * Marks are keyed on the ORDER: the stamp re-walks the whole shipment sequence, so two
 * edits on one order rebuild it once (plan 78 §4.3). Two keys because a line reaches
 * its order in two hops and a fulfillment in one, as `sales/totals/totals-reconciler.ts` does.
 */

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isRecordId, parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { MarkHandler } from '../../../field-hooks/types'
import {
  defineParentReconciler,
  resolveParentsByRelation,
} from '../../../reconcilers/parent-reconciler'
import { isFulfillmentCancelled } from './reads'
import { stampOrderShipmentTotals } from './stamp-totals'

const logger = createScopedLogger('sales:fulfillment-totals-reconciler')

/** Marked with a FULFILLMENT id; resolves to its order in one hop. */
export const FULFILLMENT_ORDER_TOTALS_RECONCILER = 'fulfillment:order-totals'
/** Marked with a FULFILLMENT LINE id; resolves to its order in two hops. */
export const FULFILLMENT_LINE_ORDER_TOTALS_RECONCILER = 'fulfillment-line:order-totals'

/** Not `fulfillment_subtotal` / `_total` / `_shipping_recognised`: the stamp writes those. */
const FULFILLMENT_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'fulfillment_status',
  'fulfillment_cancelled_at',
  'fulfillment_sequence',
])

/** The two writes a cancellation arrives as, from the connector or from a person. */
const FULFILLMENT_CANCEL_ATTRS = new Set<SystemAttribute>([
  'fulfillment_status',
  'fulfillment_cancelled_at',
])

const FULFILLMENT_LINE_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'fulfillment_line_quantity',
  'fulfillment_line_line_item',
  'fulfillment_line_fulfillment',
])

/** Shared rebuild: one order at a time, so one bad order does not block the drain. */
async function stampOrders(
  organizationId: string,
  _userId: string,
  orderInstanceIds: string[]
): Promise<void> {
  for (const orderInstanceId of orderInstanceIds) {
    try {
      await stampOrderShipmentTotals(database, organizationId, orderInstanceId)
    } catch (error) {
      logger.error('fulfillment totals stamp failed for one order — continuing with the rest', {
        organizationId,
        orderInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

const fulfillmentReconciler = defineParentReconciler<string>({
  key: FULFILLMENT_ORDER_TOTALS_RECONCILER,
  resolve: (organizationId, fulfillmentInstanceIds) =>
    resolveParentsByRelation(organizationId, 'fulfillment_order', fulfillmentInstanceIds),
  rebuildBatch: stampOrders,
})

const fulfillmentLineReconciler = defineParentReconciler<string>({
  key: FULFILLMENT_LINE_ORDER_TOTALS_RECONCILER,
  resolve: async (organizationId, lineInstanceIds) => {
    const fulfillmentIds = await resolveParentsByRelation(
      organizationId,
      'fulfillment_line_fulfillment',
      lineInstanceIds
    )
    if (fulfillmentIds.length === 0) return []
    return resolveParentsByRelation(organizationId, 'fulfillment_order', fulfillmentIds)
  },
  rebuildBatch: stampOrders,
})

/** Register both drains. Called from `registerAllHooks()`. */
export function registerFulfillmentTotalsReconcilers(): void {
  fulfillmentReconciler.register()
  fulfillmentLineReconciler.register()
}

// Inline carries a `TypedFieldValue`, buffered the bare `RecordId`, sync nothing.
function readRelatedInstanceId(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const recordId =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && (value as { type?: string }).type === 'relationship'
        ? (value as { recordId?: string }).recordId
        : undefined
  if (!recordId || !isRecordId(recordId)) return null
  return parseRecordId(recordId as RecordId).entityInstanceId
}

/**
 * Take a cancelled shipment's revenue back out, before the order re-stamps (88 D9).
 *
 * Idempotent by construction, which is what makes it safe here: the mark lane
 * cannot tell "became cancelled" from "was already cancelled", and
 * `reverseFulfillmentPosting` is a `null` no-op when the fulfillment holds no
 * live posting. Never throws — a reversal that fails must not stop the drain.
 */
async function reverseCancelledFulfillment(
  organizationId: string,
  userId: string,
  fulfillmentInstanceId: string
): Promise<void> {
  try {
    if (!(await isFulfillmentCancelled(database, { organizationId, fulfillmentInstanceId }))) return
    // Imported here, not at the top: `orders/fulfill` reaches back into this
    // module through the `../fulfillments` barrel.
    const { reverseFulfillmentPosting } = await import('../orders/fulfill')
    await reverseFulfillmentPosting(database, {
      organizationId,
      fulfillmentInstanceId,
      actorUserId: userId,
      memo: 'Shipment cancelled',
    })
  } catch (error) {
    logger.error('cancelled fulfillment reversal failed — the order still re-stamps', {
      organizationId,
      fulfillmentInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const stampTotalsOnFulfillmentChange: MarkHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !FULFILLMENT_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  // A record written this instant has no posting to reverse, so only a later
  // write can mean "cancelled now".
  if (!event.isCreate && FULFILLMENT_CANCEL_ATTRS.has(attr)) {
    await reverseCancelledFulfillment(event.organizationId, event.userId, entityInstanceId)
  }
  await fulfillmentReconciler.mark(event.organizationId, event.userId, entityInstanceId)
}

// A re-pointed line's two-hop resolve reaches only its new order, so the vacated
// fulfillment is marked directly when the lane carries `oldValue`.
export const stampTotalsOnFulfillmentLineChange: MarkHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !FULFILLMENT_LINE_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await fulfillmentLineReconciler.mark(event.organizationId, event.userId, entityInstanceId)

  if (attr === 'fulfillment_line_fulfillment') {
    const vacatedFulfillmentId = readRelatedInstanceId(event.oldValue)
    if (vacatedFulfillmentId) {
      await fulfillmentReconciler.mark(event.organizationId, event.userId, vacatedFulfillmentId)
    }
  }
}
