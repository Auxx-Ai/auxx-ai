// packages/lib/src/money/credit-memos/apply.ts
//
// Applying an issued credit memo's balance against an open invoice, and taking
// it back. An application is an entity row, not a `PaymentAllocation`: it is
// not money, it posts nothing, and its only effects are `invoice_amount_credited`
// (through `syncInvoicePaymentState`) and the memo's own settlement figures
// (through `settleCreditMemo`). See plans/accounting/tasks/10 sections 2.3,
// 3.3 and 5.2.
//
// `planCreditApplication`, the pure planner, lives in `client.ts` so the apply
// dialog can prefill with it; it is re-exported here for section 10.7.

import type { Database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { settledPeriodsFor } from '../../postings/settled-periods'
import { UnifiedCrudHandler } from '../../resources/crud'
import { syncInvoicePaymentState } from '../payments/ledger'
import {
  loadCreditMemoApplication,
  loadInvoiceForCredit,
  requireCreditMemo,
  sumCreditMemoApplications,
  sumInvoiceCreditApplications,
  sumSucceededCreditMemoRefunds,
} from './reads'
import { settleCreditMemo } from './settle'

export {
  type CreditMemoForApplication,
  type PlannedCreditApplication,
  planCreditApplication,
} from './client'

/** The invoice statuses credit can be applied to: something is still owed. */
const APPLICABLE_INVOICE_STATUSES: ReadonlySet<string> = new Set(['sent', 'partially_paid'])

export interface ApplyCreditMemoInput {
  organizationId: string
  userId: string
  creditMemoInstanceId: string
  invoiceInstanceId: string
  /** Integer minor units, > 0, at most the memo's balance and the invoice's balance. */
  amount: number
}

export interface ApplyCreditMemoResult {
  applicationInstanceId: string
}

/**
 * Apply part of an issued memo's balance to one invoice.
 *
 * Refuses over EITHER balance, and both balances are re-derived from their
 * sources rather than read off the mirrors: the memo's from its applications
 * and succeeded refunds, the invoice's from `total - paid - Σ applications`.
 * The mirrors are projections written after the fact, and a refusal that
 * trusted them could let two concurrent applications each pass on the same
 * stale figure.
 *
 * The memo and the invoice must belong to the same contact. Credit is a
 * statement about what one customer is owed; moving it onto another
 * customer's invoice is a journal entry, not an application.
 */
export async function applyCreditMemo(
  db: Database,
  input: ApplyCreditMemoInput
): Promise<ApplyCreditMemoResult> {
  const { organizationId, userId, creditMemoInstanceId, invoiceInstanceId, amount } = input

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BadRequestError('The amount to apply must be a whole number of cents above zero', {
      creditMemoInstanceId,
      invoiceInstanceId,
    })
  }

  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)
  if (memo.status !== 'issued') {
    throw new BadRequestError(
      memo.status === 'draft'
        ? 'Issue this credit memo before applying it'
        : memo.status === 'settled'
          ? 'This credit memo is settled - it has no balance left to apply'
          : 'A void credit memo cannot be applied',
      { creditMemoInstanceId, status: memo.status }
    )
  }

  const invoice = await loadInvoiceForCredit(db, organizationId, invoiceInstanceId)
  if (!invoice) throw new NotFoundError('Invoice not found', { invoiceInstanceId })
  if (!APPLICABLE_INVOICE_STATUSES.has(invoice.status)) {
    throw new BadRequestError(
      invoice.status === 'draft'
        ? 'Send this invoice before applying credit to it'
        : invoice.status === 'paid'
          ? `Invoice ${invoice.number} is paid in full - there is nothing to apply credit to`
          : `Cannot apply credit to a ${invoice.status.replace(/_/g, ' ')} invoice`,
      { invoiceInstanceId, status: invoice.status }
    )
  }
  if (
    memo.contactInstanceId &&
    invoice.contactInstanceId &&
    memo.contactInstanceId !== invoice.contactInstanceId
  ) {
    throw new BadRequestError(
      `Credit memo ${memo.number} and invoice ${invoice.number} belong to different contacts`,
      { creditMemoInstanceId, invoiceInstanceId }
    )
  }

  const [applied, refunded, invoiceCredited] = await Promise.all([
    sumCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    memo.source === 'channel'
      ? Promise.resolve(memo.amountRefundedMinor)
      : sumSucceededCreditMemoRefunds(db, organizationId, creditMemoInstanceId),
    sumInvoiceCreditApplications(db, organizationId, invoiceInstanceId),
  ])
  const memoBalance = Math.max(0, memo.totalMinor - applied - refunded)
  const invoiceBalance = Math.max(0, invoice.totalMinor - invoice.amountPaidMinor - invoiceCredited)

  if (amount > memoBalance) {
    throw new BadRequestError(
      `Applying ${amount} exceeds the ${memoBalance} left on credit memo ${memo.number}`,
      {
        creditMemoInstanceId,
        amountMinor: String(amount),
        balanceMinor: String(memoBalance),
      }
    )
  }
  if (amount > invoiceBalance) {
    throw new BadRequestError(
      `Applying ${amount} exceeds the ${invoiceBalance} still owed on invoice ${invoice.number}`,
      {
        invoiceInstanceId,
        amountMinor: String(amount),
        balanceMinor: String(invoiceBalance),
      }
    )
  }

  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await handler.create('credit_memo_application', {
    credit_memo_application_credit_memo: toRecordId('credit_memo', creditMemoInstanceId),
    credit_memo_application_invoice: toRecordId('invoice', invoiceInstanceId),
    credit_memo_application_amount: amount,
    credit_memo_application_applied_at: new Date().toISOString(),
  })

  await syncInvoicePaymentState({ organizationId, userId, invoiceInstanceId, db })
  await settleCreditMemo(db, { organizationId, userId, creditMemoInstanceId })

  return { applicationInstanceId: created.instance.id }
}

export interface UnapplyCreditMemoInput {
  organizationId: string
  userId: string
  applicationInstanceId: string
}

/**
 * Take an application back: delete the row, re-project the invoice, re-settle
 * the memo.
 *
 * Refused when the application's date falls in a settled period. The
 * application itself posts nothing, but the invoice balance it moved is what
 * A/R aging reported for that month, and a closed month's aging is corrected
 * by a new application dated today, never by editing what the month said.
 */
export async function unapplyCreditMemo(
  db: Database,
  input: UnapplyCreditMemoInput
): Promise<void> {
  const { organizationId, userId, applicationInstanceId } = input

  const application = await loadCreditMemoApplication(db, organizationId, applicationInstanceId)
  if (!application) {
    throw new NotFoundError('Credit application not found', { applicationInstanceId })
  }

  const appliedAt = application.appliedAt ? new Date(application.appliedAt) : null
  if (appliedAt && !Number.isNaN(appliedAt.getTime())) {
    const settled = await settledPeriodsFor(organizationId, [appliedAt])
    if (settled.size > 0) {
      throw new ConflictError(
        `This credit was applied in ${[...settled.keys()].join(', ')}, which has been closed ` +
          'or posted. Apply a new credit or record a refund instead of undoing history.',
        { applicationInstanceId, periods: [...settled.keys()].join(',') }
      )
    }
  }

  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  await handler.delete(toRecordId('credit_memo_application', applicationInstanceId))

  if (application.invoiceInstanceId) {
    await syncInvoicePaymentState({
      organizationId,
      userId,
      invoiceInstanceId: application.invoiceInstanceId,
      db,
    })
  }
  if (application.creditMemoInstanceId) {
    await settleCreditMemo(db, {
      organizationId,
      userId,
      creditMemoInstanceId: application.creditMemoInstanceId,
    })
  }
}
