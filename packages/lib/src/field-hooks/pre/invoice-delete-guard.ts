// packages/lib/src/field-hooks/pre/invoice-delete-guard.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { listInvoiceMoneyPayments } from '../../accounting/money/invoice-payments/payment-reads'
import { unstampSourceLines } from '../../accounting/sales/invoices/invoice-lifecycle'
import { hasLiveInvoicePostings } from '../../accounting/sales/invoices/post-invoice'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { PermissionKey, requirePermission } from '../../permissions'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `invoices` (plans/dispatch/money/12-delete-safety.md §A). Fires inside
 * `deleteEntity` for EVERY delete path, generic `record.delete`, bulk delete, the drawer's
 * `money.deleteInvoice`, and any future Kopilot/API caller, closing the gap where only the
 * drawer's bespoke lifecycle delete (`invoice-lifecycle.ts`) enforced these invariants.
 *
 * Two refusals the registry cannot express:
 *
 *   1. **Permission.** Anyone who is not the system user needs `dispatchBoardManage`.
 *   2. **REFUSE while a money-model receipt is still applied.** Accounting migration step 0
 *      dropped the legacy `PaymentTransaction`/`payment` mirror lane along with its own
 *      version of this check; `listInvoiceMoneyPayments` nets `unapply` against `apply`, so a
 *      fully-unapplied receipt no longer blocks the delete.
 *   3. **REFUSE on a live general-ledger entry.** Only voiding is allowed then; see below.
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

  const payments = await listInvoiceMoneyPayments(database, { organizationId, invoiceInstanceId })
  if (payments.length > 0) {
    throw new BadRequestError('Remove recorded payments before deleting this invoice')
  }

  // An invoice with a general-ledger entry standing against it cannot be
  // deleted, only voided (plans/accounting/tasks/done/08-invoice-revenue.md §3.5).
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

  await unstampSourceLines(organizationId, userId, recordId)
}
