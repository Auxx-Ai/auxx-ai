// packages/lib/src/postings/build-payment-entry.ts

/**
 * The payment entry: a receivable turning into money, wherever that money lands.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   charge:   Dr undeposited_funds | cash | clearing_shopify     amount
 *                 Cr accounts_receivable                             allocated
 *                 Cr customer_deposits                               the rest
 *
 *   refund:   Dr accounts_receivable                             allocated
 *             Dr customer_deposits                               the rest
 *                 Cr undeposited_funds | cash | clearing_shopify     amount
 * ```
 *
 * ## 🛑 The credit side SPLITS, and that split is the accounting
 *
 * Money taken before delivery is money you OWE. Crediting the whole receipt to
 * `accounts_receivable` books a prepayment as a receivable with the sign
 * flipped: a $10,000 deposit on quote acceptance drives `1100` $10,000 negative
 * and leaves `2350 Customer Deposits` at zero, understating both sides of the
 * balance sheet by the whole deposit book. Both entries balance, so nothing
 * downstream can tell.
 *
 * {@link BuildPaymentEntryInput.allocatedMinor} is how much of this transaction
 * is applied to an invoice AT POST TIME. The rest is a customer deposit.
 *
 * Two rules carry the design, and neither belongs in this file:
 *
 * 1. **The receipt entry records what was true when the money arrived**, and is
 *    never amended when allocations change later. On the day the money came in,
 *    none of it was owed.
 * 2. **A later allocation is its own entry** - `build-deposit-application-entry.ts`,
 *    a reclass out of the liability into the receivable, dated the day the
 *    allocation was made.
 *
 * A REFUND needs no branch. `refundCharge` copies the charge's allocations onto
 * the refund row when it creates it, so the refund's own `allocatedMinor`
 * computes the same way and lands on the same accounts the receipt used: a
 * refunded held deposit debits `customer_deposits`, a refunded applied payment
 * debits `accounts_receivable`, and a deposit applied and then refunded debits
 * `accounts_receivable`, which is where the `DPA` entry had already moved it.
 *
 * ## The debit side is a ROUTE, not a guess
 *
 * `resolvePaymentRoute(method, settings)` in `money/bank-deposits/route.ts` is
 * the authority and it is per-method for a reason worth repeating here, because
 * every wrong answer still balances:
 *
 * - **Cheque and cash** are banked in a RUN. Five cheques arrive at the bank as
 *   ONE line, so five separate cash postings can never match it. They wait in
 *   `undeposited_funds` until a `bank_deposit` posts the single cash line.
 * - **ACH and wire** arrive alone and match their own bank line, so they go
 *   straight to cash.
 * - **Card** settles as a NET payout days later. It goes to a clearing account
 *   which `buildPayoutEntry` drains; routing it through undeposited funds would
 *   assert a gross deposit the bank never credited.
 *
 * ## ⚠️ Two things this file does NOT decide
 *
 * 1. **The posting type.** `POSTING_TYPES` gained `payment` in drizzle 0361,
 *    but the caller still supplies it: the builder is pure and the writer is
 *    the one that knows what it is posting. See
 *    {@link BuildPaymentEntryInput.postingType}.
 * 2. **Which clearing account.** `ACCOUNT_ROLES` has exactly one clearing role,
 *    `clearing_shopify` (`1200`), so `'clearing'` maps to it. The chart also
 *    holds `1210 Affirm Clearing` with no role, and its own warning: Affirm
 *    settlements are invisible to the payouts API, so an Affirm order routed to
 *    `1200` makes that account impossible to reconcile to zero. When a second
 *    clearing role lands, {@link PAYMENT_ROUTE_ROLE} grows a discriminator on
 *    the gateway rather than on the method.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md §1.2
 * @see plans/accounting/tasks/06-deposit-grouping.md §2.3
 */

import { UnprocessableEntityError } from '../errors'
import type { PaymentRoute } from '../money/bank-deposits/client'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import { hashedPeriodKey } from './period-key'
import type { BuiltEntry, GlPostingLineInput, PostingType } from './types'

/**
 * The `sourceType` every payment line carries.
 *
 * 🛑 `payment_transaction`, the LEDGER ROW, never `payment`, the entity mirror.
 * Refund rows get no `payment` mirror at all (`money/payments/ledger.ts`), so
 * anything sourced on the entity silently misses every refund.
 */
export const PAYMENT_SOURCE_TYPE = 'payment_transaction'

/**
 * Where each route's money sits in the chart. DECLARED, one row per route.
 *
 * Type-only import of `PaymentRoute` so `postings/` gains no runtime edge into
 * `money/` - the dependency runs the other way and a second copy of the union
 * would be free to drift.
 */
export const PAYMENT_ROUTE_ROLE: Record<PaymentRoute, AccountRole> = {
  undeposited_funds: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
  cash: ACCOUNT_ROLES.CASH,
  // One clearing role exists today. See the file header on `1210 Affirm Clearing`.
  clearing: ACCOUNT_ROLES.CLEARING_SHOPIFY,
}

/** The `PaymentTransaction` fields an entry is built from. Nothing else is read. */
export interface PaymentEntryTransaction {
  /** `PaymentTransaction.id`. A cuid - every line's `sourceId`, never the period key. */
  id: string
  /** `'charge'` takes money in; `'refund'` gives it back and mirrors the entry. */
  kind: 'charge' | 'refund'
  /** `PaymentTransaction.amount`, integer minor units, always positive. */
  amountMinor: number
  /** `cash | check | card | bank | other`, for the memo. The ROUTE is resolved by the caller. */
  method: string | null | undefined
  /** `PaymentTransaction.currency`. Anything but `ledgerCurrency` refuses. */
  currency: string | null | undefined
  /** `YYYY-MM-DD`. The accounting date, which is not when the row was keyed. */
  receivedAt: string
  /** `PaymentTransaction.reference` - a cheque number. Memo only. */
  reference?: string | null
}

export interface BuildPaymentEntryInput {
  /**
   * A parameter rather than a literal, so the builder stays a total function of
   * its arguments.
   *
   * A payment is neither a `payout` (that is the gateway's net settlement days
   * later) nor a `manual_journal` (nobody hand-keyed it). `POSTING_TYPES` has
   * carried `payment` since drizzle 0361 and `postPaymentTransaction` passes
   * it; the builder simply takes what it is given.
   */
  postingType: PostingType
  transaction: PaymentEntryTransaction
  /** From `resolvePaymentRoute(method, settings)`. Never inferred here. */
  route: PaymentRoute
  /**
   * `PaymentTransaction.id` is a cuid and blows the 21-character document-number
   * cap outright, so the key is minted - {@link paymentPeriodKey}.
   */
  periodKey: string
  /** The one currency the books are kept in. Passed in so this file stays pure. */
  ledgerCurrency: string
  /**
   * How much of this transaction is applied to an invoice AT POST TIME, in
   * integer minor units, `0` to `transaction.amountMinor`.
   *
   * The rest is a customer deposit: money held, not a receivable relieved. See
   * the file header for why the split is the accounting rather than a detail.
   *
   * Computed by the caller as the sum of the transaction's `PaymentAllocation`
   * rows. Every writer inserts the allocation BEFORE `syncTransaction` runs, so
   * an ordinary invoice payment already carries its allocation here and routes
   * wholly to `accounts_receivable`, exactly as it did before the split
   * existed.
   */
  allocatedMinor: number
  memo?: string
}

export interface BuiltPaymentEntry {
  entry: BuiltEntry
  periodKey: string
  /** The account the money landed in (a charge) or came back out of (a refund). */
  routeRole: AccountRole
  /** Integer minor units, always positive - `direction` carries the sign. */
  amountMinor: number
  /** The part of {@link amountMinor} that relieved a receivable. */
  receivableMinor: number
  /** The part of {@link amountMinor} that is held as a customer deposit. */
  depositMinor: number
}

/**
 * The prefix a payment's minted key carries.
 *
 * 🛑 `PAY` is already `payout`'s document-number prefix, so a payment cannot
 * reuse it. `PMT` is what `DOC_NUMBER_PREFIX.payment` declares.
 */
export const PAYMENT_PERIOD_KEY_PREFIX = 'PMT'

/**
 * Mint the period key for one payment transaction.
 *
 * A short hash of the transaction id, never a counted sequence. The whole
 * argument, including why `already_posted` has to be defended against rather
 * than trusted, lives in `period-key.ts` - this is a three-line adapter onto
 * it so that the payment entry and the deposit application share one keyspace
 * implementation instead of two copies free to drift.
 */
export function paymentPeriodKey(transactionId: string): string {
  return hashedPeriodKey({
    prefix: PAYMENT_PERIOD_KEY_PREFIX,
    sourceId: transactionId,
    label: 'payment entry',
    idLabel: 'transaction id',
  })
}

/**
 * Build one payment entry, or throw naming what stopped it.
 *
 * A REFUND is the same entry with both directions swapped, not a negative
 * amount: `GlPostingLine.amount` is always positive and `direction` is the only
 * carrier of sign, so a refund debits the receivable back and credits the
 * account the money left from.
 *
 * @throws {UnprocessableEntityError} on a foreign currency, an amount that is
 *   not a positive whole number of minor units, or an `allocatedMinor` that is
 *   negative, fractional or larger than the amount received.
 */
export function buildPaymentEntry(input: BuildPaymentEntryInput): BuiltPaymentEntry {
  const { postingType, transaction, route, periodKey, ledgerCurrency, allocatedMinor, memo } = input
  const { id, kind, amountMinor, method, currency, receivedAt, reference } = transaction

  const paymentCurrency = currency?.trim() || ledgerCurrency
  if (paymentCurrency !== ledgerCurrency) {
    throw new UnprocessableEntityError(
      `This payment is in ${paymentCurrency} and the ledger is kept in ${ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { transactionId: id, currency: paymentCurrency, ledgerCurrency }
    )
  }

  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new UnprocessableEntityError(
      `Payment ${id} is ${String(amountMinor)}. An amount is a positive whole number of minor ` +
        'units - a refund is the direction, not a negative number.',
      { transactionId: id, amountMinor: String(amountMinor) }
    )
  }

  if (
    !Number.isFinite(allocatedMinor) ||
    !Number.isInteger(allocatedMinor) ||
    allocatedMinor < 0 ||
    allocatedMinor > amountMinor
  ) {
    throw new UnprocessableEntityError(
      `Payment ${id} says ${String(allocatedMinor)} of ${amountMinor} is applied to an invoice. ` +
        'The applied part is a whole number of minor units between zero and the whole amount - ' +
        'anything else would split the credit between a receivable and a customer deposit on ' +
        'numbers that do not add up to what was received.',
      {
        transactionId: id,
        allocatedMinor: String(allocatedMinor),
        amountMinor: String(amountMinor),
      }
    )
  }

  const routeRole = PAYMENT_ROUTE_ROLE[route]
  const source = { sourceType: PAYMENT_SOURCE_TYPE, sourceId: id }
  const label = `${kind === 'refund' ? 'Refund' : 'Payment'}${method ? ` (${method})` : ''}${
    reference ? ` ${reference}` : ''
  }`

  const routeDirection = kind === 'refund' ? 'credit' : 'debit'
  // The mirror of the route leg. A charge relieves a receivable or raises a
  // deposit liability; a refund does the opposite of whichever the receipt did.
  const settlementDirection = kind === 'refund' ? 'debit' : 'credit'

  const receivableMinor = allocatedMinor
  const depositMinor = amountMinor - allocatedMinor

  // Route, receivable, deposits. A zero leg is omitted rather than posted:
  // `buildEntry` refuses a line that moves nothing, and a two-line entry is
  // what a fully applied payment and a wholly held deposit each are.
  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: routeRole,
      direction: routeDirection,
      amount: amountMinor,
      memo: memo ?? label,
      sortOrder: 0,
    },
  ]

  if (receivableMinor > 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: settlementDirection,
      amount: receivableMinor,
      memo: memo ?? label,
      sortOrder: 1,
    })
  }

  if (depositMinor > 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
      direction: settlementDirection,
      amount: depositMinor,
      memo: memo ?? `${label} (customer deposit)`,
      sortOrder: 2,
    })
  }

  const entry = buildEntry({ postingType, periodKey, txnDate: receivedAt, lines })

  return { entry, periodKey, routeRole, amountMinor, receivableMinor, depositMinor }
}
