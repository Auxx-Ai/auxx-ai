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
