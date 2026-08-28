// packages/lib/src/purchasing/match-reconciler.ts

/**
 * The three-way match as a dirty-parent reconciler
 * (`plans/events/08-derived-parent-reconciler-plan.md`, the money engine's twin).
 *
 * `rematchOnBillLineChange` fires on four attributes, once per changed field, and
 * each fire re-matched the whole bill. Entering a 10-line bill was ~30 matches.
 * Now each fire marks and the drain matches once.
 *
 * Two keys, for the same reason the money reconciler has six: the drain has to
 * know whether it was handed a bill or one of its lines.
 *
 * Phase 3 moved the registration, the mark-or-inline pair, the dedupe loop and
 * the single-relation parent resolve into `reconcilers/parent-reconciler.ts`;
 * what is left below is the two things that are actually this subsystem's — which
 * relation a bill line hangs off, and that the rebuild is `rematchBill`.
 */

import { defineParentReconciler, resolveParentsByRelation } from '../reconcilers/parent-reconciler'

export const MATCH_VENDOR_BILL = 'three-way-match:vendor_bill'
export const MATCH_VENDOR_BILL_LINE = 'three-way-match:vendor_bill_line'

/**
 * Match one bill.
 *
 * `rematchBill` is lazy-imported so this module carries no runtime edge back to
 * `match-hook`, which imports it.
 */
async function rematchOne(
  organizationId: string,
  userId: string,
  vendorBillInstanceId: string
): Promise<void> {
  const { rematchBill } = await import('./match-hook')
  await rematchBill({ organizationId, userId, vendorBillInstanceId })
}

const billReconciler = defineParentReconciler<string>({
  key: MATCH_VENDOR_BILL,
  rebuild: rematchOne,
})

const billLineReconciler = defineParentReconciler<string>({
  key: MATCH_VENDOR_BILL_LINE,
  /**
   * The bill each line hangs off, in ONE query. The per-line version was a
   * `getFieldValues` per line, called once per changed attribute — four round
   * trips for one line whose quantity, price and PO link all moved in the same
   * write.
   */
  resolve: (organizationId, lineInstanceIds) =>
    resolveParentsByRelation(organizationId, 'vendor_bill_line_vendor_bill', lineInstanceIds),
  rebuild: rematchOne,
})

/** Register both drains. Called from `registerAllHooks()`, idempotent per key. */
export function registerMatchReconcilers(): void {
  billReconciler.register()
  billLineReconciler.register()
}

/**
 * Mark a bill for rematch, or rematch it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `ParentReconciler.mark`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the bill
 * would silently stop leaving the exception queue.
 */
export const markOrRematchBill = billReconciler.mark

/** {@link markOrRematchBill}'s line-side twin — the bill is resolved in the drain. */
export const markOrRematchBillLine = billLineReconciler.mark

/**
 * Re-run the three-way match on every bill that charges these purchase order lines.
 *
 * 🛑 **The receipt leg had no trigger, and that made the match's answer depend on
 * the order two documents happened to arrive in.** The match re-runs on a bill
 * write and on a bill LINE write (`BILL_MATCH_TRIGGER_ATTRS`,
 * `BILL_LINE_MATCH_TRIGGER_ATTRS`) — and on nothing else. So a bill entered
 * *before* the goods arrive records `billed 1 but only 0 received`, an honest
 * verdict at the time, and then **nothing ever revisits it**. Receiving the goods
 * moves `purchase_order_line_quantity_received` and leaves the exception standing
 * for good.
 *
 * Found 2026-08-28 in dev data, which is the only place it could have been found:
 * bill `BILL-0005` carries *"Line 1: billed 1 but only 0 received"* stamped at
 * 21:32:22, against a line whose receipt landed at 21:37:50. Every unit test
 * passed, because each one drives the match directly and none of them models two
 * documents arriving in the wrong order.
 *
 * Why it matters more than one stale string: `exception` is the queue a person is
 * meant to work, and plan P6's whole argument for automating the match is that
 * *"a control that requires a person to compare three documents by hand is a
 * control that stops being run in week three."* A queue holding exceptions that
 * are no longer true is the same failure, reached from the other side — it teaches
 * people to clear the queue without reading it.
 *
 * Called from the RECEIPT roll-up only, and only for lines whose received total
 * actually moved. The billed roll-up needs nothing: a bill line write already
 * fires the hook that drives this.
 *
 * Never throws — it runs post-commit behind a quantity that is already committed,
 * and `markOrRematchBill` isolates each bill internally.
 */
export async function rematchBillsForPurchaseOrderLines(
  organizationId: string,
  userId: string,
  purchaseOrderLineInstanceIds: string[]
): Promise<void> {
  const lineIds = [...new Set(purchaseOrderLineInstanceIds)].filter(Boolean)
  if (lineIds.length === 0) return

  const [{ database, schema }, { getOrgCache }, { and, eq, inArray }] = await Promise.all([
    import('@auxx/database'),
    import('../cache'),
    import('drizzle-orm'),
  ])

  // The INVERSE of `vendor_bill_line_purchase_order_line`, read from the bill-line
  // side rather than through the purchase order line's `_vendor_bill_lines` mirror:
  // the mirror is a maintained copy and this is the fact itself. One query.
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['vendor_bill_line_purchase_order_line'] as const)
  const relField = fields.vendor_bill_line_purchase_order_line
  // An org without the field has no bills to rematch — not an error.
  if (!relField) return

  const rows = await database
    .select({ billLineId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, relField.id),
        inArray(schema.FieldValue.relatedEntityId, lineIds)
      )
    )
  const billLineIds = [...new Set(rows.map((row) => row.billLineId))]
  if (billLineIds.length === 0) return

  // Bill lines to their bills in ONE query, then one rematch per DISTINCT bill —
  // a five-line bill against one receipt must be matched once, not five times.
  const billIds = [
    ...new Set(
      await resolveParentsByRelation(organizationId, 'vendor_bill_line_vendor_bill', billLineIds)
    ),
  ]
  for (const billId of billIds) {
    await markOrRematchBill(organizationId, userId, billId)
  }
}
