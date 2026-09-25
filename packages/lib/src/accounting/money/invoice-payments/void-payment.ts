// packages/lib/src/accounting/money/invoice-payments/void-payment.ts

/**
 * Undoing a payment that should never have been recorded.
 *
 * ## 🛑 A reversal, never a compensating entry
 *
 * The receipt's own posting is reversed (TARGET §5: "reverse. Never a
 * compensating entry"), which frees the movement's subject claim so the same
 * receipt could post again if it is ever re-recorded. Nothing is deleted: the
 * `MoneyTransaction` stands and the applications are taken back with `unapply`
 * rows, so the invoice owes what it owed.
 *
 * ## ⚠️ This is NOT how you move money to another invoice
 *
 * A void says *the receipt was a mistake*. If the money is real and simply
 * belongs against a different invoice, that is `moveInvoicePayment`: an
 * `unapply`/`apply` pair with the receipt left exactly as it stands.
 */

import type { Database } from '@auxx/database'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingActive } from '../../ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import { runMoneyCommand } from '../commands/run-money-command'
import { listLiveApplications } from '../reads'
import { insertApplication } from '../writes'
import { syncInvoicePaymentState } from './payment-state'

export interface VoidInvoicePaymentInput {
  organizationId: string
  userId: string
  /** The `MoneyTransaction` to void. Must be a `customer_receipt`. */
  moneyTransactionId: string
  /** Why, for the journal memo and the audit trail. */
  reason?: string
  /** Idempotency key. A retry returns the first run's ids. */
  commandKey: string
}

export interface VoidInvoicePaymentResult extends Record<string, string> {
  glPostingId: string
}

/**
 * Void one recorded payment: reverse its posting, unapply its money, and
 * reproject every invoice it touched.
 *
 * @throws {UnprocessableEntityError} when the receipt never posted, and
 *   {@link ConflictError} when the ledger refuses the reversal - the money
 *   model is not touched in either case.
 */
export async function voidInvoicePayment(
  db: Database,
  input: VoidInvoicePaymentInput
): Promise<VoidInvoicePaymentResult> {
  if (!(await isAccountingActive(input.organizationId)))
    throw new UnprocessableEntityError('Accounting is not enabled for this organization')

  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (live.isErr()) throw live.error
  if (!live.value)
    throw new UnprocessableEntityError('That payment has no standing journal to reverse')

  // 🛑 The ledger goes FIRST: a refused reversal must leave the money model
  // exactly as it was, or the invoice reads settled with no entry behind it.
  const reversal = await reverseEntry(db, {
    organizationId: input.organizationId,
    glPostingId: live.value.id,
    actorUserId: input.userId,
    memo: input.reason?.trim() || 'Payment recorded in error',
  })
  if (!didLedgerAccept(reversal))
    throw new ConflictError(
      `That payment's journal could not be reversed${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}`,
      { moneyTransactionId: input.moneyTransactionId }
    )

  const result = await runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'void_invoice_payment',
      payload: { moneyTransactionId: input.moneyTransactionId, reason: input.reason ?? null },
    },
    async (tx, commandId) => {
      // 🔑 Free the invoice. Without this the receivable is relieved in the
      // ledger and still shows as settled on the document.
      const effectiveDate = await todayInBookTimeZone(input.organizationId)
      // Live rows only: an application a move already took back off invoice A
      // must not be reversed a second time (LIB-READS §0.1 bug 1).
      const applications = await listLiveApplications(
        tx,
        input.organizationId,
        input.moneyTransactionId
      )
      for (const [index, application] of applications.entries())
        await insertApplication(tx, input.organizationId, commandId, {
          moneyTransactionId: input.moneyTransactionId,
          operation: 'unapply',
          amountMinor: application.amountMinor,
          invoiceInstanceId: application.invoiceInstanceId,
          orderInstanceId: application.orderInstanceId,
          vendorBillInstanceId: application.vendorBillInstanceId,
          effectiveDate,
          reversesApplicationId: application.id,
          commandItemKey: `unapply:${index}`,
        })

      // `payment-state.ts` is the only writer of the invoice's mirrors, so
      // every invoice this receipt touched is reprojected before returning.
      for (const invoiceInstanceId of new Set(
        applications.flatMap((a) => (a.invoiceInstanceId ? [a.invoiceInstanceId] : []))
      ))
        await syncInvoicePaymentState({
          organizationId: input.organizationId,
          userId: input.userId,
          invoiceInstanceId,
          db: tx as unknown as Database,
        })

      return { glPostingId: reversal.glPostingId ?? live.value!.id }
    }
  )

  return result
}
