// packages/lib/src/postings/build-payment-entry.ts

/**
 * The payment entry: a receivable turning into money, wherever that money lands.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   charge:   Dr undeposited_funds | cash | clearing_shopify     amount
 *                 Cr accounts_receivable                             amount
 *
 *   refund:   Dr accounts_receivable                             amount
 *                 Cr undeposited_funds | cash | clearing_shopify     amount
 * ```
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
 * 1. **The posting type.** There is no `payment` member in `POSTING_TYPES`
 *    (`types.ts` is coordinator-held), so the caller supplies one. See
 *    {@link BuildPaymentEntryInput.postingType} - the whole reason it is a
 *    parameter rather than a literal.
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
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
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
   * 🛑 **A parameter, not a literal, because the right value does not exist yet.**
   *
   * A payment is neither a `payout` (that is the gateway's net settlement days
   * later) nor a `manual_journal` (nobody hand-keyed it), and `POSTING_TYPES`
   * has no `payment` member. `types.ts`, `doc-number.ts` and `regime.ts` are
   * coordinator-held and the union has exactly two copies which must move in
   * one change, so this slot does not add one. The writer passes
   * `'payment' as PostingType` with a TODO; the builder simply takes what it is
   * given and stays honest about knowing nothing.
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
  memo?: string
}

export interface BuiltPaymentEntry {
  entry: BuiltEntry
  periodKey: string
  /** The account the money landed in (a charge) or came back out of (a refund). */
  routeRole: AccountRole
  /** Integer minor units, always positive - `direction` carries the sign. */
  amountMinor: number
}

/**
 * The prefix a payment's minted key carries.
 *
 * 🛑 `PAY` is already `payout`'s document-number prefix, so a payment cannot
 * reuse it. `PMT` is the one this slot recommends to the coordinator when the
 * `payment` posting type lands.
 */
export const PAYMENT_PERIOD_KEY_PREFIX = 'PMT'

const MAX_COMPACT_PERIOD_KEY = DOC_NUMBER_MAX_LENGTH - 'AUXX-XXX-'.length - '-R9'.length

/**
 * Mint the period key for one payment transaction.
 *
 * ## Why a hash of the id and not a counted sequence
 *
 * `PaymentTransaction` has **no number column** - no `number`, no sequence,
 * nothing short and stable. The `payment` entity mirror does not help either:
 * refunds never get one. So the key has to be derived from the id, and the id
 * is a 24-character cuid, which `AUXX-PMT-<cuid>` blows past the 21-character
 * cap on its own.
 *
 * The obvious alternative - `PMT-0001`, `PMT-0002`, counted off the existing
 * postings - is the one shape that is actively dangerous here. Two payments
 * recorded concurrently both read the same count and mint the same key; the
 * claim's unique index on `(organizationId, postingType, periodKey, revision)`
 * then converges the loser to `already_posted`, which is a SUCCESS status. Two
 * different payments would silently become one entry and the second one's cash
 * would never appear. A hash of the transaction id cannot do that: it is
 * deterministic (a re-post of the same row converges correctly, which is what
 * `already_posted` is FOR) and needs no lock.
 *
 * 🛑 **It is not collision-PROOF, only collision-unlikely.** The suffix is six
 * base-36 digits, so the keyspace is 36^6 = 2.2e9 and two DISTINCT transactions
 * can in principle hash to one key - at which point the loser converges to
 * `already_posted`, a SUCCESS status, and its cash never appears. That is why
 * `postPaymentTransaction` does not trust `already_posted` on its own: it reads
 * the existing posting's line `sourceId` and refuses unless it is this
 * transaction. Do not widen or narrow this hash without reading that check.
 *
 * The cost is a document number a human cannot tie back to a payment by
 * reading it. That is what `sourceId` and the memo are for, and it is a far
 * smaller cost than a merged entry.
 */
export function paymentPeriodKey(transactionId: string): string {
  const id = transactionId.trim()
  if (!id) {
    throw new UnprocessableEntityError('A payment entry needs the transaction id to key on')
  }
  // FNV-1a, 32 bit. Not cryptographic and does not need to be: this is a
  // keyspace, not a secret, and a pure function beats importing node:crypto
  // into a file that has to stay client-safe.
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // Six base-36 digits, not seven: `AUXX-PMT-` is nine characters and a
  // reversal adds three, so nine are left for the compacted key and `PMT`
  // takes three of them. Folded with a modulus rather than sliced, so all 32
  // bits contribute to the six digits that survive - a slice would throw away
  // the high digit's entropy for nothing. 36^6 is 2.2e9 distinct keys, which is
  // the collision bound the JSDoc above states and `postPaymentTransaction`
  // defends against.
  const folded = hash % 36 ** 6
  const suffix = folded.toString(36).toUpperCase().padStart(6, '0')
  const key = `${PAYMENT_PERIOD_KEY_PREFIX}-${suffix}`
  const compact = key.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    // Unreachable while the prefix is three characters and the suffix six.
    // Asserted so a widening of either cannot quietly mint an unpostable key.
    throw new UnprocessableEntityError(
      `Payment period key "${key}" compacts to ${compact.length} characters, over ${MAX_COMPACT_PERIOD_KEY}`,
      { periodKey: key }
    )
  }
  return key
}

/**
 * Build one payment entry, or throw naming what stopped it.
 *
 * A REFUND is the same entry with both directions swapped, not a negative
 * amount: `GlPostingLine.amount` is always positive and `direction` is the only
 * carrier of sign, so a refund debits the receivable back and credits the
 * account the money left from.
 *
 * @throws {UnprocessableEntityError} on a foreign currency, or an amount that is
 *   not a positive whole number of minor units.
 */
export function buildPaymentEntry(input: BuildPaymentEntryInput): BuiltPaymentEntry {
  const { postingType, transaction, route, periodKey, ledgerCurrency, memo } = input
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

  const routeRole = PAYMENT_ROUTE_ROLE[route]
  const source = { sourceType: PAYMENT_SOURCE_TYPE, sourceId: id }
  const label = `${kind === 'refund' ? 'Refund' : 'Payment'}${method ? ` (${method})` : ''}${
    reference ? ` ${reference}` : ''
  }`

  const routeDirection = kind === 'refund' ? 'credit' : 'debit'
  const receivableDirection = kind === 'refund' ? 'debit' : 'credit'

  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: routeRole,
      direction: routeDirection,
      amount: amountMinor,
      memo: memo ?? label,
      sortOrder: 0,
    },
    {
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: receivableDirection,
      amount: amountMinor,
      memo: memo ?? label,
      sortOrder: 1,
    },
  ]

  const entry = buildEntry({ postingType, periodKey, txnDate: receivedAt, lines })

  return { entry, periodKey, routeRole, amountMinor }
}
