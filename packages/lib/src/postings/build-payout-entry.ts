// packages/lib/src/postings/build-payout-entry.ts

/**
 * The payout entry: a gateway's settlement, gross minus fees, landing as one
 * bank deposit days after the sales it settles.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr <the settlement's own bank account>   the whole deposit that reached the bank
 *   Dr payment_processing_fees               fees withheld on the RECOGNISED charges
 *       Cr clearing_card                           RECOGNISED gross
 *       Cr unidentified_receipts                   the unrecognised remainder, net
 * ```
 *
 * This is the entry that makes `1200 Card Clearing` reconcilable. A card
 * receipt DEBITS the clearing account gross at the sale (`buildPaymentEntry`
 * with route `clearing`), and this entry credits it gross again, net to the
 * bank account the payout settled into and the difference to fees. A settled
 * batch therefore leaves the clearing account at zero, and a non-zero balance
 * is a list of sales the gateway has not paid out yet - which is a useful
 * control on its own.
 *
 * ## 🛑 A bank account is not a role (brief 13 §2)
 *
 * The debit used to be `ACCOUNT_ROLES.CASH`, which resolved to whichever
 * single account held the role - so a payout settling into Wells Fargo
 * Checking and the bank feed's own line for the same money could land in two
 * different accounts and still balance, with nothing comparing them. The debit
 * is now the SETTLEMENT'S OWN bank account, resolved by the caller from the
 * payout's Stripe destination (`money/payouts/sync.ts`) and passed in as
 * {@link BuildPayoutEntryInput.bankAccountGlAccountId}. This file never reads a
 * `bank_account` itself - it stays PURE - it only takes the id the caller
 * already resolved and confirmed.
 *
 * ## 🛑 The fourth leg, and why it is not optional
 *
 * A gateway payout settles EVERY charge the merchant took, including charges
 * taken outside auxx - a payment link sent from the Stripe dashboard, a
 * subscription on the same account, a terminal. Those were never debited to
 * `clearing_card`, so crediting the payout's full gross to clearing drives that
 * account permanently negative by the amount auxx never took. Relieving only
 * the recognised part and debiting the bank account to match would keep
 * clearing right and break the bank instead: the bank feed shows ONE deposit
 * for the whole payout.
 *
 * So all three of the following hold at once, and only this shape gets all
 * three:
 *
 * - **the bank account takes the WHOLE deposit**, so the entry matches the
 *   bank line;
 * - **clearing is relieved of exactly what auxx put in it**, so it still
 *   reconciles to zero;
 * - **the remainder is visible in one account somebody must work**
 *   (`unidentified_receipts`, `2450`) rather than silently distorting either.
 *
 * When every charge in the payout is recognised the fourth leg is zero and gets
 * dropped, which is the ordinary case and the original three-line entry exactly.
 *
 * ⚠️ `unrecognisedNetMinor` is a NET figure - gross less the fee withheld on
 * those same charges. The fee on money auxx never took is not auxx's
 * `payment_processing_fees`: it is embedded in the remainder and gets sorted out
 * when the receipt is attributed.
 *
 * ## ⚠️ `money/payments/fees.ts` is the WRONG number
 *
 * Task 01 §1.3 says "reuse it; do not recompute". That points at
 * `resolveApplicationFee`, which is the **platform's Connect application fee**
 * (auxx's own cut, default 2%). The number this entry needs is the fee the
 * PROCESSOR withheld, and it lives on Stripe's balance transaction, which auxx
 * does not store. So `feesMinor` is an input, and it must come from a payout
 * source, not from that file.
 *
 * ## ⚠️ And `1210 Affirm Clearing` must be excluded
 *
 * The chart's own note: an Affirm settlement never lands on the card rail and
 * is invisible to the payouts API, so folding Affirm-gateway orders into `1200`
 * means it can never reconcile to zero. `clearingRole` is an input for that
 * reason - one payout drains ONE clearing account.
 *
 * ## The gatherer
 *
 * `money/payouts/gather-payout.ts` is the read that fills this input from
 * Stripe, and `money/payouts/sync-payouts.ts` is what walks an org's payouts and
 * posts them. Both landed 2026-09-07; the file header used to say no payout
 * source existed at all.
 *
 * ✅ The account this drains is `1200 Card Clearing`, named for the RAIL.
 * It was `Shopify Clearing` / `clearing_shopify` until entity migration 132,
 * which reconciled perfectly and read as a lie: `PaymentTransaction.provider` is
 * `'manual' | 'stripe'` and there is no Shopify payment rail in auxx at all, so
 * every Stripe card receipt was accumulating in an account named for a provider
 * the money never touched.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md §1.3
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

/** The `sourceType` every payout line carries. */
export const PAYOUT_SOURCE_TYPE = 'payout'

/**
 * The clearing roles a payout may drain. `clearing_card`, and only ever that.
 *
 * 🛑 **Every non-card rail is excluded BY CONSTRUCTION, not by omission.** An
 * Affirm settlement never lands on the card rail, so it is invisible to the
 * payouts API and no payout can ever relieve the account holding it (accrual
 * plan §3, 49 §3.2). Widening this list would let a card payout drain an
 * account its deposit never touched: the entry would balance, that account
 * would go negative by the sales it was holding, and nothing downstream could
 * detect it.
 *
 * This list is roles, and a non-card rail no longer HAS a role - it is a
 * `payment_gateway` record whose clearing account the fulfillment entry debits
 * by id (`clearing_affirm` was deleted on 2026-09-10). So the exclusion is now
 * structural rather than a name left off a list: an id-routed debit is not
 * `clearing_card`, and `clearing_card` is the only thing here. Each such rail
 * clears when a settlement feed for it exists, through its own entry.
 */
export const PAYOUT_CLEARING_ROLES: readonly AccountRole[] = [ACCOUNT_ROLES.CLEARING_CARD]

export interface BuildPayoutEntryInput {
  /** The gateway's own payout id. Every line's `sourceId`. */
  payoutId: string
  /**
   * The `gl_account` id of the `bank_account` this payout settled into,
   * resolved by the caller from the payout's Stripe destination against a
   * CONFIRMED `bank_account.stripeExternalAccountId` (brief 13 §2.3). Never a
   * role: an org has several bank accounts and the payout settles into exactly
   * one of them, so a role would send every payout to whichever single account
   * happened to hold it. The caller refuses to call this function at all when
   * the destination cannot be resolved - see `money/payouts/sync.ts`.
   */
  bankAccountGlAccountId: string
  /**
   * The short, human key the document number is built on.
   *
   * 🛑 **`doc-number.ts` says `payout` keys on the payout id, and that rule
   * only works while the id is short.** Shopify can issue two payouts in a day,
   * so a DATE key would merge them into one entry whose total ties to neither
   * deposit - and reconciling `1200` is exactly what would then be impossible.
   * A Stripe `po_…` id is 27 characters and blows the 21-character cap, so the
   * caller passes a short number when it has one and the id when it is short
   * enough; this function refuses the rest, naming the length.
   */
  payoutNumber: string
  /** Total sales settled, integer minor units. Equals `net + fees`. */
  grossMinor: number
  /** What the processor withheld, integer minor units. May be zero. */
  feesMinor: number
  /**
   * What actually reached the bank, integer minor units. The RECOGNISED net -
   * `grossMinor - feesMinor` - NOT the payout's total. The whole deposit is
   * `netMinor + unrecognisedNetMinor`, and that is what lands on
   * {@link bankAccountGlAccountId}.
   */
  netMinor: number
  /**
   * The net settled by charges auxx has no `PaymentTransaction` for, integer
   * minor units, credited to `unidentified_receipts`. See the fourth-leg
   * section in this file's header.
   *
   * Optional and defaulted to `0`: a caller that has already established every
   * charge is recognised - a test, or a payout whose balance transactions all
   * matched - says nothing rather than passing a zero.
   */
  unrecognisedNetMinor?: number
  /** Which clearing account this payout drains. See the file header on Affirm. */
  clearingRole: AccountRole
  /** `YYYY-MM-DD`. The date the money reached the bank. */
  paidAt: string
  memo?: string
}

export interface BuiltPayoutEntry {
  entry: BuiltEntry
  periodKey: string
  grossMinor: number
  feesMinor: number
  netMinor: number
  unrecognisedNetMinor: number
  /** What hit the bank: `netMinor + unrecognisedNetMinor`. The bank-account debit leg. */
  depositedMinor: number
}

const MAX_COMPACT_PERIOD_KEY = DOC_NUMBER_MAX_LENGTH - 'AUXX-PAY-'.length - '-R9'.length

function assertMinor(value: number, label: string, payoutNumber: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `Payout ${payoutNumber}: ${label} is ${String(value)}, which is not a whole number of cents.`,
      { payoutNumber, label, value: String(value) }
    )
  }
  return value
}

/**
 * Build one payout entry, or throw naming what stopped it.
 *
 * 🛑 **`gross !== net + fees` is a REFUSAL, not a plug.** Balancing it by
 * treating one of the three as derived would hide the one thing this entry
 * exists to surface: a settlement whose arithmetic does not agree with the
 * gateway's is a mis-read payout, and posting it anyway leaves a clearing
 * account that can never reach zero for reasons nobody can reconstruct.
 *
 * @throws {UnprocessableEntityError} on a fractional or negative amount, an
 *   arithmetic disagreement, an over-long payout number, a missing
 *   `bankAccountGlAccountId`, or a `clearingRole` that is not a clearing
 *   account.
 */
export function buildPayoutEntry(input: BuildPayoutEntryInput): BuiltPayoutEntry {
  const { payoutId, payoutNumber, clearingRole, paidAt, memo } = input
  const bankAccountGlAccountId = input.bankAccountGlAccountId?.trim()

  const number = payoutNumber.trim()
  if (!number) {
    throw new UnprocessableEntityError(
      'A payout entry needs a short payout number to key its document number on - never a bare ' +
        'gateway id, which is over the 21-character cap, and never a date, because two payouts ' +
        'can settle on one day.',
      { payoutId }
    )
  }
  if (!bankAccountGlAccountId) {
    throw new UnprocessableEntityError(
      `Payout ${number} has no bank account to debit. A payout settles into a specific bank ` +
        "account, never a role - resolve the payout's Stripe destination to a confirmed " +
        'bank_account first.',
      { payoutId, payoutNumber: number }
    )
  }
  const compact = number.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    throw new UnprocessableEntityError(
      `Payout number "${number}" compacts to ${compact.length} characters and the document number ` +
        `allows ${MAX_COMPACT_PERIOD_KEY}. Key on a short payout number rather than the gateway's id.`,
      { payoutId, payoutNumber: number, length: String(compact.length) }
    )
  }

  if (!PAYOUT_CLEARING_ROLES.includes(clearingRole)) {
    throw new UnprocessableEntityError(
      `Payout ${number} names "${clearingRole}", which is not a clearing account. A payout drains ` +
        `exactly one of: ${PAYOUT_CLEARING_ROLES.join(', ')}.`,
      { payoutNumber: number, clearingRole }
    )
  }

  const grossMinor = assertMinor(input.grossMinor, 'gross', number)
  const feesMinor = assertMinor(input.feesMinor, 'fees', number)
  const netMinor = assertMinor(input.netMinor, 'net', number)
  const unrecognisedNetMinor = assertMinor(
    input.unrecognisedNetMinor ?? 0,
    'unrecognised net',
    number
  )

  if (grossMinor <= 0) {
    throw new UnprocessableEntityError(
      `Payout ${number} settles ${grossMinor}. A payout that moves nothing has no entry.`,
      { payoutNumber: number, grossMinor: String(grossMinor) }
    )
  }
  if (feesMinor < 0 || netMinor < 0) {
    throw new UnprocessableEntityError(
      `Payout ${number} has net ${netMinor} and fees ${feesMinor}. Both are positive amounts - ` +
        'direction carries the sign.',
      { payoutNumber: number, netMinor: String(netMinor), feesMinor: String(feesMinor) }
    )
  }
  // 🛑 Negative is a REFUSAL rather than a clamp. A negative remainder means the
  // recognised net exceeds the payout - auxx thinks it took more than the
  // gateway settled - and the only honest answers are a mis-read payout or a
  // double-posted charge. Clamping to zero would post a plausible entry over
  // either.
  if (unrecognisedNetMinor < 0) {
    throw new UnprocessableEntityError(
      `Payout ${number} leaves an unrecognised remainder of ${unrecognisedNetMinor}. A negative ` +
        'remainder means auxx recognised MORE than the gateway settled, which is a mis-read ' +
        'payout or a double-posted charge, never a rounding difference.',
      { payoutNumber: number, unrecognisedNetMinor: String(unrecognisedNetMinor) }
    )
  }
  if (netMinor + feesMinor !== grossMinor) {
    throw new UnprocessableEntityError(
      `Payout ${number} does not add up: net ${netMinor} + fees ${feesMinor} = ` +
        `${netMinor + feesMinor}, but gross is ${grossMinor}, off by ` +
        `${Math.abs(grossMinor - netMinor - feesMinor)} (in cents). The gateway's own three ` +
        'numbers must agree before the clearing account can ever reconcile to zero.',
      {
        payoutNumber: number,
        grossMinor: String(grossMinor),
        netMinor: String(netMinor),
        feesMinor: String(feesMinor),
      }
    )
  }

  const depositedMinor = netMinor + unrecognisedNetMinor

  const source = { sourceType: PAYOUT_SOURCE_TYPE, sourceId: payoutId }
  const lines: GlPostingLineInput[] = [
    {
      ...source,
      // 🛑 The settlement's OWN bank account, by id - never the `cash` role
      // (brief 13 §2). The caller resolved and confirmed it before calling in.
      glAccountId: bankAccountGlAccountId,
      // 🛑 The WHOLE deposit, not the recognised net. This leg is what the bank
      // line matches against, and the bank shows one figure for the payout.
      direction: 'debit',
      amount: depositedMinor,
      memo: memo ?? `Payout ${number} - deposited`,
      sortOrder: 0,
    },
  ]
  // Dropped when zero rather than posted at zero: an org whose processor
  // withheld nothing has no reason to have mapped `payment_processing_fees`.
  if (feesMinor !== 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
      direction: 'debit',
      amount: feesMinor,
      memo: `Payout ${number} - processor fees withheld`,
      sortOrder: 1,
    })
  }
  lines.push({
    ...source,
    accountRole: clearingRole,
    direction: 'credit',
    amount: grossMinor,
    memo: `Payout ${number} - gross settled`,
    sortOrder: 2,
  })
  // Dropped when zero, like the fee leg: the ordinary payout recognises
  // everything in it, and an org that has never taken a charge outside auxx has
  // no reason to have mapped `unidentified_receipts`.
  if (unrecognisedNetMinor !== 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS,
      direction: 'credit',
      amount: unrecognisedNetMinor,
      memo: `Payout ${number} - settled charges auxx has no payment for`,
      sortOrder: 3,
    })
  }

  const entry = buildEntry({
    postingType: 'payout',
    periodKey: number,
    txnDate: paidAt,
    lines,
  })

  return {
    entry,
    periodKey: number,
    grossMinor,
    feesMinor,
    netMinor,
    unrecognisedNetMinor,
    depositedMinor,
  }
}
