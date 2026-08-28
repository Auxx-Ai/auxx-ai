// packages/lib/src/money/billing-reconciler.ts

/**
 * The work-order billing projection as a dirty-parent reconciler
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
 */

import { getOrgCache } from '../cache'
import { readFieldRelations } from '../field-values/read-field-scalars'
import { markParentDirty, registerReconciler } from '../reconcilers/dirty-parents'

export const BILLING_LINE_ITEM = 'billing:line_item'
export const BILLING_WORK_ORDER = 'billing:work_order'
export const BILLING_INVOICE = 'billing:invoice'
export const BILLING_CONTACT = 'billing:contact'

let registered = false

/** Register the four drains. Called from `registerAllHooks()`, idempotent. */
export function registerBillingReconcilers(): void {
  if (registered) return
  registered = true

  registerReconciler(BILLING_LINE_ITEM, async ({ organizationId, userId, parentInstanceIds }) => {
    const workOrders = await resolveWorkOrdersForLines(organizationId, parentInstanceIds)
    await syncEach(organizationId, userId, workOrders, 'work_order')
  })

  registerReconciler(BILLING_WORK_ORDER, async ({ organizationId, userId, parentInstanceIds }) => {
    await syncEach(organizationId, userId, parentInstanceIds, 'work_order')
  })

  registerReconciler(BILLING_INVOICE, async ({ organizationId, userId, parentInstanceIds }) => {
    await syncEach(organizationId, userId, parentInstanceIds, 'invoice')
  })

  registerReconciler(BILLING_CONTACT, async ({ organizationId, userId, parentInstanceIds }) => {
    await syncEach(organizationId, userId, parentInstanceIds, 'contact')
  })
}

/** Which projector a batch belongs to. */
type Projector = 'work_order' | 'invoice' | 'contact'

/**
 * Project each distinct record once, isolating failures.
 *
 * One record failing must not lose the rest — a drain batch is several unrelated
 * documents, not one unit of work, the same rule `rematchEach` applies. The three
 * projectors are lazy-imported so this module carries no runtime edge back to
 * `billing-hooks`, which imports it.
 */
async function syncEach(
  organizationId: string,
  userId: string,
  instanceIds: string[],
  projector: Projector
): Promise<void> {
  if (instanceIds.length === 0) return
  const {
    syncContactBillingProjection,
    syncInvoiceBillingProjection,
    syncWorkOrderBillingProjection,
  } = await import('./billing-projection')

  for (const instanceId of new Set(instanceIds)) {
    if (projector === 'work_order') {
      await syncWorkOrderBillingProjection({
        organizationId,
        userId,
        workOrderInstanceId: instanceId,
      })
    } else if (projector === 'invoice') {
      await syncInvoiceBillingProjection({ organizationId, userId, invoiceInstanceId: instanceId })
    } else {
      await syncContactBillingProjection({ organizationId, userId, contactInstanceId: instanceId })
    }
  }
}

/**
 * The work order each source line hangs off, in ONE query.
 *
 * The per-line version was a `getFieldValues` per line, called once per changed
 * attribute — so a line whose quantity, price and description all moved in one
 * write cost three round trips to answer the same question three times.
 */
async function resolveWorkOrdersForLines(
  organizationId: string,
  lineInstanceIds: string[]
): Promise<string[]> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_work_order'] as const)
  const relField = cf.line_item_work_order
  if (!relField) return []

  const rels = await readFieldRelations(undefined, organizationId, lineInstanceIds, [relField.id])

  const workOrders: string[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const workOrder = rels.get(lineInstanceId)?.get(relField.id)
    if (workOrder) workOrders.push(workOrder)
  }
  return workOrders
}

/**
 * Mark a work order for projection, or project it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `markParentDirty`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this the
 * work order's contract and uninvoiced amounts would silently stop updating.
 */
export async function markOrSyncWorkOrder(
  organizationId: string,
  userId: string,
  workOrderInstanceId: string
): Promise<void> {
  if (markParentDirty(BILLING_WORK_ORDER, workOrderInstanceId)) return
  await syncEach(organizationId, userId, [workOrderInstanceId], 'work_order')
}

/** {@link markOrSyncWorkOrder}'s line-side twin — the parent is resolved in the drain. */
export async function markOrSyncLine(
  organizationId: string,
  userId: string,
  lineInstanceId: string
): Promise<void> {
  if (markParentDirty(BILLING_LINE_ITEM, lineInstanceId)) return
  const workOrders = await resolveWorkOrdersForLines(organizationId, [lineInstanceId])
  await syncEach(organizationId, userId, workOrders, 'work_order')
}

/** {@link markOrSyncWorkOrder} for the invoice projector. */
export async function markOrSyncInvoice(
  organizationId: string,
  userId: string,
  invoiceInstanceId: string
): Promise<void> {
  if (markParentDirty(BILLING_INVOICE, invoiceInstanceId)) return
  await syncEach(organizationId, userId, [invoiceInstanceId], 'invoice')
}

/** {@link markOrSyncWorkOrder} for the customer aggregate. */
export async function markOrSyncContact(
  organizationId: string,
  userId: string,
  contactInstanceId: string
): Promise<void> {
  if (markParentDirty(BILLING_CONTACT, contactInstanceId)) return
  await syncEach(organizationId, userId, [contactInstanceId], 'contact')
}
