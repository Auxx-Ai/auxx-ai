// packages/lib/src/accounting/money/vendor-payments/void-payment.ts

/**
 * Undoing a vendor payment that should never have been recorded — the mirror of
 * `invoice-payments/void-payment.ts`.
 *
 * 🛑 A reversal, never a compensating entry, and nothing is deleted: the
 * `MoneyTransaction` stands and its applications are taken back with `unapply`
 * rows, so the bill owes what it owed.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { runMoneyCommand } from '../commands/run-money-command'
import { syncVendorBillPaymentState } from './payment-state'

export interface VoidVendorPaymentInput {
  organizationId: string
  userId: string
  /** The `MoneyTransaction` to void. Must be a `vendor_payment`. */
  moneyTransactionId: string
  /** Why, for the journal memo and the audit trail. */
  reason?: string
  /** Idempotency key. A retry returns the first run's ids. */
  commandKey: string
}

export interface VoidVendorPaymentResult extends Record<string, string> {
  glPostingId: string
}

/**
 * Void one vendor payment: reverse its posting when it has one, unapply its
 * money, and reproject every bill it touched.
 */
export async function voidVendorPayment(
  db: Database,
  input: VoidVendorPaymentInput
): Promise<VoidVendorPaymentResult> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (live.isErr()) throw live.error

  // 🛑 The ledger goes FIRST: a refused reversal must leave the money model
  // exactly as it was, or the bill reads settled with no entry behind it. An
  // unposted payment (accounting off, or the post was blocked) has nothing to
  // reverse and the unapply still has to happen.
  let glPostingId = ''
  if (live.value) {
    if (!(await isAccountingEnabled(db, input.organizationId)))
      throw new UnprocessableEntityError('Accounting is not enabled for this organization')
    const lock = await resolvePeriodLock(input.organizationId)
    const reversal = await reverseEntry(db, {
      organizationId: input.organizationId,
      glPostingId: live.value.id,
      actorUserId: input.userId,
      lock,
      memo: input.reason?.trim() || 'Vendor payment recorded in error',
    })
    if (!didLedgerAccept(reversal))
      throw new ConflictError(
        `That payment's journal could not be reversed${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}`,
        { moneyTransactionId: input.moneyTransactionId }
      )
    glPostingId = reversal.glPostingId ?? live.value.id
  }

  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'void_vendor_payment',
      payload: { moneyTransactionId: input.moneyTransactionId, reason: input.reason ?? null },
    },
    async (tx, commandId) => {
      const effectiveDate = new Date().toISOString().split('T')[0]!
      const applications = await tx.query.MoneyApplication.findMany({
        where: and(
          eq(schema.MoneyApplication.organizationId, input.organizationId),
          eq(schema.MoneyApplication.moneyTransactionId, input.moneyTransactionId),
          eq(schema.MoneyApplication.operation, 'apply')
        ),
      })
      for (const [index, application] of applications.entries())
        await tx.insert(schema.MoneyApplication).values({
          organizationId: input.organizationId,
          moneyTransactionId: input.moneyTransactionId,
          operation: 'unapply',
          amountMinor: application.amountMinor,
          // Taken back with the money, so the bill's discounted mirror re-sums
          // to zero and its balance returns to what it owed (74 D3).
          discountMinor: application.discountMinor,
          vendorBillInstanceId: application.vendorBillInstanceId,
          appliedAt: new Date(),
          effectiveDate,
          reversesApplicationId: application.id,
          commandId,
          commandItemKey: `unapply:${index}`,
        })

      for (const vendorBillInstanceId of new Set(
        applications.flatMap((a) => (a.vendorBillInstanceId ? [a.vendorBillInstanceId] : []))
      ))
        await syncVendorBillPaymentState(tx as unknown as Database, {
          organizationId: input.organizationId,
          userId: input.userId,
          vendorBillInstanceId,
        })

      return { glPostingId }
    }
  )
}
