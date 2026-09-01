// packages/lib/src/field-hooks/pre/purchase-order-delete-guard.ts

import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'
import { findRelatedInstanceIds } from './related-rows'

/**
 * Pre-delete guard for `purchase-orders`
 * (plans/money/tasks/21-money-parent-delete-safety.md §4). Fires inside
 * `deleteEntity` for EVERY delete path, because `purchase-orders` is
 * `isVisible: true` and has carried an ordinary row delete and bulk delete since
 * the day it shipped.
 *
 * **What deleting a purchase order costs today.** The order row goes and every
 * child survives: the `purchase_order_line`s are orphaned, the receipt
 * `stock_movement`s under them are untouched (they point at the LINE, so
 * `sweepEntityFieldValues` never even sees them), and any `vendor_bill` naming
 * the order loses its match anchor.
 *
 * 🛑 **And the sweep BLANKS the link rather than dangling it.** A dangling id is
 * evidence — you can still see what the child pointed at. A swept relation
 * leaves the line with an empty Purchase Order cell and no trace that a parent
 * ever existed, so an unguarded delete here is unrecoverable rather than merely
 * wrong.
 *
 * ⚠️ **The missing lever, for the third recorded time.** A line's
 * `quantityOrdered` and `expectedUnitPrice` are evidence-locked against EDITS
 * the moment a receipt or a bill line exists
 * (`pre/purchase-order-line-evidence-lock.ts`), and there is no delete
 * counterpart — so the line cannot be edited but can be deleted outright, or the
 * order above it. `docs/inventory-costing-architecture-guide.md` §6.4 records
 * the shape: `updatable: false` and the evidence lock are both claims about
 * edits only, and there is no `deletable: false` in the schema at all.
 *
 * Two refusals and one cascade:
 *
 *   1. **REFUSE when any `vendor_bill` names this order.**
 *   2. **REFUSE when any receipt under any of its lines sits in a settled
 *      period.** Note the two-hop read — movements name the line, not the order.
 *   3. **CASCADE the receipts, then the lines.**
 */
export const guardPurchaseOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const handler = new UnifiedCrudHandler(organizationId, userId)

  // Refuse BEFORE any cascade, so a rejected delete mutates nothing.
  await refuseIfBilled(organizationId, recordId)

  const lineIds = await readLineIds(organizationId, recordId)
  const movements = await readMovementsByRelation(
    organizationId,
    'stock_movement_purchase_order_line',
    lineIds
  )

  if (movements.length > 0) {
    const settled = await settledPeriodsFor(
      organizationId,
      movements.map((movement) => movement.accountingDate)
    )
    if (settled.size > 0) {
      throw new BadRequestError(
        `This purchase order has ${describeSettledPeriods(settled, 'receipt')}. ` +
          `A posted period is corrected by reversing an entry, never by deleting its ` +
          `history — archive the order instead.`,
        { organizationId, recordId, periods: [...settled.keys()] }
      )
    }
  }

  // 🛑 Receipts first, lines second. `mfg-stock-movements-deleted` recomputes
  // `recalculatePartQoH` for the received part (a survivor, so nothing is
  // suppressed) and also `recalculatePurchaseOrderLineReceived` against a line
  // that is about to be deleted — wasted, but harmless, and suppressing it to
  // avoid the waste would take the QoH recompute down with it.
  for (const movement of movements) {
    await handler.delete(toRecordId('stock_movement', movement.id))
  }

  // A line's `purchaseOrder` relation is `required: true` in the registry, so a
  // line without an order is invalid by the schema's own definition. That is the
  // argument for cascading rather than orphaning, and it is a stronger one than
  // the order/line-item guard had to make.
  for (const lineId of lineIds) {
    await handler.delete(toRecordId('purchase_order_line', lineId))
  }
}

/**
 * Refuse when a vendor has billed against this order.
 *
 * ⚠️ **This is where the task departs from `guardPartDelete`, deliberately.**
 * That guard LEAVES the vendor's own documents alone, on the grounds that a
 * vendor really did bill us for that thing. The distinction: a bill line
 * surviving a *part* delete is still a complete document that merely lost a
 * cell, whereas a bill surviving its *order*'s delete has lost the anchor the
 * three-way match is computed against — `purchasing/match.ts` reads the order
 * leg to produce a verdict at all.
 */
async function refuseIfBilled(organizationId: string, recordId: RecordId): Promise<void> {
  const { entityInstanceId } = parseRecordId(recordId)
  // ⚠️ Through `findRelatedInstanceIds`, NOT `listFiltered` — an ARCHIVED bill
  // still names this order, and the shared list path cannot see one. Driving
  // this guard on 2026-08-31 deleted `PO-0002` out from under exactly that.
  const ids = await findRelatedInstanceIds(
    organizationId,
    'vendor_bill',
    'vendor_bill_purchase_order',
    [entityInstanceId]
  )

  if (ids.length > 0) {
    throw new BadRequestError(
      `This purchase order has ${ids.length} vendor ${ids.length === 1 ? 'bill' : 'bills'} ` +
        `billed against it. Deleting the order would leave the three-way match with no order ` +
        `leg — delete or unlink the bills first, or archive the order instead.`,
      { organizationId, recordId, vendorBillIds: ids }
    )
  }
}

/** The order's own lines. */
async function readLineIds(organizationId: string, recordId: RecordId): Promise<readonly string[]> {
  const { entityInstanceId } = parseRecordId(recordId)
  // Archived lines are collected too — a line left behind by its order is the
  // strand this cascade exists to prevent, and archiving it does not change that.
  return findRelatedInstanceIds(
    organizationId,
    'purchase_order_line',
    'purchase_order_line_purchase_order',
    [entityInstanceId]
  )
}
