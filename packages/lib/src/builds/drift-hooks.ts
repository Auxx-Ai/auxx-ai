// packages/lib/src/builds/drift-hooks.ts

/**
 * The four seams that can change what an order asks production for
 * (plans/products/13 Model A+).
 *
 * Every one of them does exactly one thing — mark the order dirty — and the
 * drain in `drift-reconciler.ts` re-stamps it once. That is the contract
 * `reconcilers/dirty-parents.ts` exists to enforce: a hook performs no reads and
 * no writes of its own, so pasting twenty lines re-stamps the order once rather
 * than forty times.
 *
 * 🛑 **None of these touches a build.**
 */

import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { EntityFieldChangeHandler, EntityPostDeleteHandler } from '../field-hooks/types'
import { markOrStampOrder, markOrStampOrderLine } from './drift-reconciler'

/**
 * Line attributes that move the DEMAND, and only those.
 *
 * `line_item_order` is here for the same reason `money/totals-hooks.ts` carries
 * its rel triggers: a line just attached to (or detached from) an order changes
 * what that order asks for, and no other attribute fires when it happens.
 *
 * ⚠️ `line_item_unit_price` and the rest of the money vocabulary are deliberately
 * ABSENT. A price change moves the totals, never the production demand, and
 * including it would re-stamp — and so appear to make drift move — on an edit
 * that asks the floor for nothing different.
 */
export const LINE_DEMAND_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'line_item_part',
  'line_item_qty',
  'line_item_order',
])

/**
 * Order attributes that move the demand.
 *
 * Cancellation only. An order's own fields are otherwise a document header —
 * dates, statuses, money — and none of them changes what is to be made.
 */
export const ORDER_DEMAND_TRIGGER_ATTRS = new Set<SystemAttribute>(['order_cancelled_at'])

/** A line's part, quantity or parent order moved. */
export const stampOrderOnLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !LINE_DEMAND_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await markOrStampOrderLine(event.organizationId, entityInstanceId)

  // A REPARENTED line changes two orders: the one it left now asks for less.
  // The new parent is covered by the mark above, which resolves the line's
  // CURRENT order; the old one is only reachable through `oldValue`.
  if (attr === 'line_item_order') {
    const previousOrderId = relatedInstanceId(event.oldValue)
    if (previousOrderId) await markOrStampOrder(event.organizationId, previousOrderId)
  }
}

/** The order was cancelled. It now asks production for nothing. */
export const stampOrderOnOrderChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !ORDER_DEMAND_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await markOrStampOrder(event.organizationId, entityInstanceId)
}

/**
 * A line was deleted, so its order asks for less.
 *
 * Deletes fire no field-change hook, so without this a removed line leaves the
 * order's fingerprint claiming demand that no longer exists — a drift signal
 * that is wrong in the direction that matters. The parent comes off the delete
 * event's captured values, the same way `rematchAfterBillLineDelete` reads its
 * own; the row is gone by now and cannot be read back.
 */
export const stampOrderAfterLineDelete: EntityPostDeleteHandler = async (event) => {
  const raw = event.values.line_item_order
  if (typeof raw !== 'string' || raw.length === 0) return
  const orderId = raw.includes(':') ? parseRecordId(raw as RecordId).entityInstanceId : raw

  await markOrStampOrder(event.organizationId, orderId)
}

/** The instance id inside a relationship field value, or null. */
function relatedInstanceId(value: unknown): string | null {
  const typed = Array.isArray(value) ? value[0] : value
  if (!typed || typeof typed !== 'object') return null
  const rel = typed as { type?: string; recordId?: string }
  if (rel.type !== 'relationship' || !rel.recordId) return null
  return parseRecordId(rel.recordId as RecordId).entityInstanceId
}
