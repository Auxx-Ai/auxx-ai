// packages/lib/src/money/payments/post-deposit-application.ts

/**
 * Reclassing a held customer deposit onto the invoice it was applied to.
 *
 * The write half of `postings/build-deposit-application-entry.ts`, and the
 * second half of the customer-deposit model: `buildPaymentEntry` books what was
 * true when the money arrived (a prepayment is a liability), and this books what
 * changed when it was applied (the liability becomes a relieved receivable).
 *
 * ```
 *   Dr customer_deposits      the reclassed amount
 *       Cr accounts_receivable  the same
 * ```
 *
 * ## 🛑 The receipt entry is never amended
 *
 * `already_posted` is a SUCCESS and the claim index is what makes the payment
 * path idempotent, so a second `syncTransaction` for the same transaction
 * converges rather than re-posting. That is not a limitation being worked
 * around - it is correct accounting. On the day the money came in, none of it
 * was owed. Correct by a SECOND entry, always (ground rule 6).
 *
 * ## How it knows what is left to reclass
 *
 * ```
 *   heldMinor = amountMinor
 *             - (what the receipt entry credited to accounts_receivable)
 *             - (what posted deposit_application entries have already reclassed)
 * ```
 *
 * Both subtrahends are **read from the ledger**, never stored on a new column.
 * The entries themselves are the record of what has been reclassed, so there is
 * no field to migrate and nothing that can drift out of step with them. It is
 * also what makes the ordinary case a no-op with no special case: an invoice
 * payment already carries its allocation when the receipt posts, so the receipt
 * credited the whole amount to `accounts_receivable`, `heldMinor` is zero, and
 * the loop below reclasses nothing.
 *
 * ## Never throws
 *
 * Every outcome is a `PostResult`, logged with its status, exactly as
 * `postPaymentTransaction` does. A deposit application must not fail because
 * its bookkeeping did.
 *
 * @see plans/accounting/tasks/07-customer-deposits.md
 */

import { type Database, type PaymentTransactionEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  buildDepositApplicationEntry,
  DEPOSIT_APPLICATION_POSTING_TYPE,
  DEPOSIT_APPLICATION_SOURCE_TYPE,
  depositApplicationPeriodKey,
} from '../../postings/build-deposit-application-entry'
import { ACCOUNT_ROLES } from '../../postings/build-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { postEntry } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'

const logger = createScopedLogger('money-payments-ledger')

/** The statuses that mean the ledger took the entry. */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

/**
 * The `GlPosting` statuses whose lines count as having reached the books.
 *
 * `reversed` is IN, and it has to be: a reversed original and its reversal are
 * both read here, and their `accounts_receivable` legs cancel to zero, which is
 * exactly the arithmetic a backed-out entry should contribute. Counting only
 * `posted` would see the reversal's debit without the original's credit and
 * report MORE held than the transaction is worth. `pending` is in because it
 * holds the claim. `failed` is out: it never reached the ledger.
 */
const LEDGER_STATUSES = ['posted', 'pending', 'reversed'] as const

/**
 * How much of one transaction is still sitting in `customer_deposits`.
 *
 * Reads the transaction's own `accounts_receivable` lines back out of the
 * ledger and nets them by direction, then subtracts from the amount received.
 * See the file header for why this is a read rather than a column.
 */
async function readHeldMinor(
  db: Database,
  params: { organizationId: string; transactionId: string; amountMinor: number }
): Promise<number> {
  const rows = await db
    .select({
      direction: schema.GlPostingLine.direction,
      amountMinor: schema.GlPostingLine.amountMinor,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, params.organizationId),
        eq(schema.GlPostingLine.sourceType, DEPOSIT_APPLICATION_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, params.transactionId),
        eq(schema.GlPostingLine.accountRole, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE),
        inArray(schema.GlPosting.status, [...LEDGER_STATUSES])
      )
    )

  // A charge CREDITS the receivable, so a credit is money that has left the
  // liability. `bigint({ mode: 'number' })` can arrive as the numeric string
  // form from a raw driver read, so both are handled here rather than trusted.
  let relieved = 0
  for (const row of rows) {
    const amount = typeof row.amountMinor === 'number' ? row.amountMinor : Number(row.amountMinor)
    relieved += row.direction === 'credit' ? amount : -amount
  }

  const held = params.amountMinor - relieved
  return held > 0 ? held : 0
}

/** The `deposit_application` period keys this org has already claimed, out of a candidate set. */
async function readClaimedKeys(
  db: Database,
  organizationId: string,
  keys: string[]
): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const rows = await db
    .select({ periodKey: schema.GlPosting.periodKey })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, DEPOSIT_APPLICATION_POSTING_TYPE),
        inArray(schema.GlPosting.periodKey, keys)
      )
    )
  // EVERY status, `failed` included. `postEntry` writes its row only after the
  // claim succeeded, so a failed row still holds `(org, type, key, revision 0)`
  // and a second attempt at the same allocation could never claim it again.
  return new Set(rows.map((row) => row.periodKey))
}

/** Today's date in the org's book time zone, for an allocation whose own date is unreadable. */
async function bookTimeZone(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'UTC'
}

export interface PostDepositApplicationsInput {
  organizationId: string
  transaction: PaymentTransactionEntity
  actorUserId?: string
  /** The invoice number per invoice instance id, for the line memo. Optional. */
  invoiceNumbers?: Map<string, string>
}

/**
 * Post one reclass entry per allocation of this transaction that does not have
 * one yet, until the held balance runs out.
 *
 * **Never throws.** Returns one {@link PostResult} per entry it attempted, and
 * an empty array when there is nothing to reclass - which is the ordinary case
 * for an invoice payment, whose allocation was already in place when the
 * receipt entry posted.
 *
 * ## Charges only
 *
 * A refund needs no reclass: `refundCharge` copies the charge's allocations
 * onto the refund row, so the refund's own receipt entry already debits
 * whichever account the charge's receipt credited. Posting an application for a
 * refund would move money out of a liability the refund never put there.
 */
export async function postDepositApplications(
  db: Database,
  input: PostDepositApplicationsInput
): Promise<PostResult[]> {
  const { organizationId, transaction, actorUserId, invoiceNumbers } = input

  if (transaction.kind !== 'charge') return []
  if (transaction.status !== 'succeeded' && transaction.status !== 'disputed') return []

  try {
    const allocations = await db
      .select({
        id: schema.PaymentAllocation.id,
        amount: schema.PaymentAllocation.amount,
        appliedAt: schema.PaymentAllocation.appliedAt,
        invoiceInstanceId: schema.PaymentAllocation.invoiceInstanceId,
      })
      .from(schema.PaymentAllocation)
      .where(eq(schema.PaymentAllocation.paymentTransactionId, transaction.id))
      // Oldest first, deterministically: the held balance is consumed in the
      // order the deposit was applied, which is the order a person reading the
      // register would expect.
      .orderBy(asc(schema.PaymentAllocation.appliedAt), asc(schema.PaymentAllocation.id))

    if (allocations.length === 0) return []

    const claimed = await readClaimedKeys(
      db,
      organizationId,
      allocations.map((allocation) => depositApplicationPeriodKey(allocation.id))
    )
    const pending = allocations.filter(
      (allocation) => !claimed.has(depositApplicationPeriodKey(allocation.id))
    )
    if (pending.length === 0) return []

    let heldMinor = await readHeldMinor(db, {
      organizationId,
      transactionId: transaction.id,
      amountMinor: transaction.amount,
    })
    if (heldMinor <= 0) return []

    const zone = await bookTimeZone(organizationId)
    const lock = await resolvePeriodLock(organizationId)
    const results: PostResult[] = []

    for (const allocation of pending) {
      if (heldMinor <= 0) break
      const amountMinor = Math.min(allocation.amount, heldMinor)
      if (amountMinor <= 0) continue

      // The ALLOCATION's own day, in the org's book time zone. The money
      // changed character when it was applied, not when it arrived.
      const appliedAt = periodKeyForDate(new Date(allocation.appliedAt), 'day', zone)

      const built = buildDepositApplicationEntry({
        allocationId: allocation.id,
        transactionId: transaction.id,
        amountMinor,
        appliedAt,
        invoiceNumber: invoiceNumbers?.get(allocation.invoiceInstanceId) ?? null,
      })

      const post = await postEntry(db, {
        organizationId,
        entry: built.entry,
        actorUserId,
        lock,
        memo: `Customer deposit applied - payment ${transaction.id}`,
      })
      results.push(post)

      if (ACCEPTED_POST_STATUSES.has(post.status)) {
        heldMinor -= amountMinor
      } else {
        logger.warn('A customer deposit application was not posted to the ledger', {
          organizationId,
          transactionId: transaction.id,
          allocationId: allocation.id,
          status: post.status,
          docNumber: post.docNumber,
          claimed: Boolean(post.glPostingId),
          error: post.error,
        })
        // 🛑 Stop, do not continue down the list. The held balance is shared
        // across the allocations, and carrying on after a refusal would reclass
        // a LATER allocation out of a balance the refused one still holds - so a
        // retry of the refused entry would then over-reclass. One refusal, one
        // stop, and the remaining allocations are picked up by the next
        // `syncTransaction`.
        break
      }
    }

    return results
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Could not post a customer deposit application', {
      organizationId,
      transactionId: transaction.id,
      error: message,
    })
    return [{ status: 'error', failureClass: 'data', retryable: false, error: message }]
  }
}
