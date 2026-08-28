// packages/lib/src/money/billing-reconciler.ts

/**
 * The billing projections as dirty-parent reconcilers
 * (`plans/events/08-derived-parent-reconciler-plan.md` phase 2c) — the fourth and
 * last instance of the pattern, and the mildest.
 *
 * Unlike the totals engine and the three-way match, this one arrived with two of
 * its three legs already right (plan 08 §1.0 row 3):
 *
 * - its child read is already batched — `computeWorkOrderBillingProjection` hands
 *   `readSystemValues` an `entityInstanceIds` list;
 * - it already refuses a no-op write — `projectionHasChanges` /
 *   `writeChangedProjection`, *"a projection repair that finds no changes does not
 *   create event churn"*.
 *
 * **Neither is touched here.** The only gap was coalescing:
 * `syncBillingOnLineChange` fired once per changed FIELD, resolved
 * `line_item_work_order` with a `getFieldValues` on every one of them, and rebuilt
 * the whole projection each time.
 *
 * ## Four keys, because there are three projectors
 *
 * | key | marked with | drain |
 * | --- | --- | --- |
 * | `billing:line_item` | a source LINE id | batch-resolve line -> work order, then project |
 * | `billing:work_order` | a WORK ORDER id | project it |
 * | `billing:invoice` | an INVOICE id | project it (which cascades to its work order) |
 * | `billing:contact` | a CONTACT id | project the customer aggregate |
 *
 * ## Why drain order does not matter
 *
 * The three projectors cascade **invoice -> work order -> contact**
 * (`billing-projection.ts`: the invoice projector ends by syncing its work order,
 * and the work-order projector ends by syncing its contact *"only when the
 * work-order projection actually changed"*). So whichever key drains first, a
 * downstream projection that went stale is re-run by the cascade above it — and
 * every drain reads current database truth, after all of the write's own values
 * have landed. Two keys naming the same document is wasteful, never wrong, and
 * the no-op guard already makes the second pass write nothing.
 *
 * 🛑 The one ordering dependency that is NOT absorbed by that argument lives in
 * `billing-hooks.ts`, not here: `syncBillingAfterLineDelete`'s invoice arm keeps
 * `recomputeTotals` inline and first, because the invoice projector cascades to
 * the work order, whose projection reads `invoice_total`. Plan 08 §6.1.
 */

import { defineParentReconciler, resolveParentsByRelation } from '../reconcilers/parent-reconciler'

export const BILLING_LINE_ITEM = 'billing:line_item'
export const BILLING_WORK_ORDER = 'billing:work_order'
export const BILLING_INVOICE = 'billing:invoice'
export const BILLING_CONTACT = 'billing:contact'

/**
 * The three projectors, lazy-imported so this module carries no runtime edge back
 * to `billing-hooks`, which imports it.
 */
async function projectWorkOrder(
  organizationId: string,
  userId: string,
  workOrderInstanceId: string
): Promise<void> {
  const { syncWorkOrderBillingProjection } = await import('./billing-projection')
  await syncWorkOrderBillingProjection({ organizationId, userId, workOrderInstanceId })
}

async function projectInvoice(
  organizationId: string,
  userId: string,
  invoiceInstanceId: string
): Promise<void> {
  const { syncInvoiceBillingProjection } = await import('./billing-projection')
  await syncInvoiceBillingProjection({ organizationId, userId, invoiceInstanceId })
}

async function projectContact(
  organizationId: string,
  userId: string,
  contactInstanceId: string
): Promise<void> {
  const { syncContactBillingProjection } = await import('./billing-projection')
  await syncContactBillingProjection({ organizationId, userId, contactInstanceId })
}

const workOrderReconciler = defineParentReconciler<string>({
  key: BILLING_WORK_ORDER,
  rebuild: projectWorkOrder,
})

const lineReconciler = defineParentReconciler<string>({
  key: BILLING_LINE_ITEM,
  /**
   * The work order each source line hangs off, in ONE query. The per-line version
   * was a `getFieldValues` per line, called once per changed attribute — so a line
   * whose quantity, price and description all moved in one write cost three round
   * trips to answer the same question three times.
   */
  resolve: (organizationId, lineInstanceIds) =>
    resolveParentsByRelation(organizationId, 'line_item_work_order', lineInstanceIds),
  rebuild: projectWorkOrder,
})

const invoiceReconciler = defineParentReconciler<string>({
  key: BILLING_INVOICE,
  rebuild: projectInvoice,
})

const contactReconciler = defineParentReconciler<string>({
  key: BILLING_CONTACT,
  rebuild: projectContact,
})

/** Register the four drains. Called from `registerAllHooks()`, idempotent per key. */
export function registerBillingReconcilers(): void {
  workOrderReconciler.register()
  lineReconciler.register()
  invoiceReconciler.register()
  contactReconciler.register()
}

/**
 * Mark a work order for projection, or project it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `ParentReconciler.mark`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the work
 * order's contract and uninvoiced amounts would silently stop updating.
 */
export const markOrSyncWorkOrder = workOrderReconciler.mark

/** {@link markOrSyncWorkOrder}'s line-side twin — the parent is resolved in the drain. */
export const markOrSyncLine = lineReconciler.mark

/** {@link markOrSyncWorkOrder} for the invoice projector. */
export const markOrSyncInvoice = invoiceReconciler.mark

/** {@link markOrSyncWorkOrder} for the customer aggregate. */
export const markOrSyncContact = contactReconciler.mark
