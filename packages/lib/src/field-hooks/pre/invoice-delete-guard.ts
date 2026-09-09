// packages/lib/src/field-hooks/pre/invoice-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { unstampSourceLines } from '../../money/invoice-lifecycle'
import { hasLiveInvoicePostings } from '../../money/invoices/post-invoice'
import { hasSucceededCharges } from '../../money/payments/ledger'
import { PermissionKey, requirePermission } from '../../permissions'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `invoices` (plans/dispatch/money/12-delete-safety.md §A). Fires inside
 * `deleteEntity` for EVERY delete path, generic `record.delete`, bulk delete, the drawer's
 * `money.deleteInvoice`, and any future Kopilot/API caller, closing the gap where only the
 * drawer's bespoke lifecycle delete (`invoice-lifecycle.ts`) enforced these invariants.
 *
 * Three refusals the registry cannot express, then the Drizzle-table cleanup the instance
 * delete depends on:
 *
 *   1. **Permission.** Anyone who is not the system user needs `dispatchBoardManage`.
 *   2. **REFUSE on a succeeded or disputed charge in the payment ledger.** The registry's
 *      `onDelete: 'restrict'` on `invoice_payments` refuses while a `payment` mirror row
 *      exists, and that covers every ALLOCATED succeeded charge. But the mirror is written
 *      by the webhook that allocates (`payments/ledger.ts`, `syncTransaction`), so a
 *      succeeded charge whose `PaymentTransaction.invoiceInstanceId` intent targets this
 *      invoice while its webhook is still in flight has no mirror yet. `hasSucceededCharges`
 *      reads the ledger table directly for exactly that row, which is also what makes the
 *      purge below safe: it can only ever delete rows that never succeeded.
 *   3. **REFUSE on a live general-ledger entry.** Only voiding is allowed then; see below.
 *
 * Then: purge ledger residue (clears the `PaymentTransaction.invoiceInstanceId` RESTRICT FK,
 * then the `PaymentAllocation.invoiceInstanceId` RESTRICT FK, money 16-deposit-accounting.md
 * §C.6, so the instance delete that follows this hook can never throw) and unstamp the source
 * lines.
 *
 * **What is NOT here, and why.** The invoice's own line copies are `onDelete: 'cascade'` on
 * `invoice_line_items`; the delete engine collects them, runs the line guard over every one
 * before writing anything, and publishes their lifecycle events. This hook used to delete
 * them by hand with post-delete hooks suppressed; it no longer touches a child record.
 */
export const guardInvoiceDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')
  if (userId !== systemUserId) {
    await requirePermission(userId, organizationId, PermissionKey.dispatchBoardManage)
  }

  const { entityInstanceId: invoiceInstanceId } = parseRecordId(recordId)

  if (await hasSucceededCharges(organizationId, invoiceInstanceId)) {
    throw new BadRequestError('Remove recorded payments before deleting this invoice')
  }

  // An invoice with a general-ledger entry standing against it cannot be
  // deleted, only voided (plans/accounting/tasks/08-invoice-revenue.md §3.5).
  // Deleting the document behind a posted entry leaves lines whose `sourceId`
  // resolves to nothing: the receivable and the revenue stay in the books
  // forever, and A/R aging reports them under "Unapplied and adjustments"
  // rather than against a document anybody can find. Voiding reverses the entry
  // first, which is the whole difference between the two actions once an
  // invoice has reached the ledger.
  const posted = await hasLiveInvoicePostings(database, {
    organizationId,
    invoiceId: invoiceInstanceId,
  })
  if (posted.live) {
    throw new BadRequestError(
      `This invoice is in the general ledger (${posted.docNumbers.join(', ')}). Void it instead ` +
        'of deleting it - voiding reverses the entry so the books stay explainable, and deleting ' +
        'would leave the entry behind pointing at a document that no longer exists.',
      { invoiceInstanceId, docNumbers: posted.docNumbers.join(', ') }
    )
  }

  // Only pending/failed/canceled ledger rows can remain at this point: the guard above
  // already ruled out any succeeded/disputed charge (allocated to this invoice OR merely
  // targeting it, money 16-deposit-accounting.md §C.6), and a succeeded refund can't exist
  // without one. Purge them directly so the instance delete below never trips the
  // intent-column RESTRICT FK.
  await database
    .delete(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.invoiceInstanceId, invoiceInstanceId)
      )
    )

  // `PaymentAllocation.paymentTransactionId` cascades with the purge above, but an allocation
  // row carries its OWN restrict FK to this invoice (`PaymentAllocation.invoiceInstanceId`),
  // independent of which transaction it belongs to. The guard above already proves no
  // succeeded/disputed charge is allocated here, which is exactly what it checks, so no
  // allocation row should survive the purge; this is a defensive delete to guarantee that
  // RESTRICT FK never blocks the instance delete that follows this hook, even if that
  // invariant is ever violated by a future writer.
  await database
    .delete(schema.PaymentAllocation)
    .where(
      and(
        eq(schema.PaymentAllocation.organizationId, organizationId),
        eq(schema.PaymentAllocation.invoiceInstanceId, invoiceInstanceId)
      )
    )

  await unstampSourceLines(organizationId, userId, recordId)
}
