// packages/lib/src/postings/build-payout-entry.ts

/**
 * The payout entry: a gateway's settlement, gross minus fees, landing as one
 * bank deposit days after the sales it settles.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr cash                        net deposited
 *   Dr payment_processing_fees     fees withheld
 *       Cr clearing_shopify              gross
 * ```
 *
 * This is the entry that makes `1200 Shopify Clearing` reconcilable. A card
 * receipt DEBITS the clearing account gross at the sale (`buildPaymentEntry`
 * with route `clearing`), and this entry credits it gross again, net to cash
 * and the difference to fees. A settled batch therefore leaves the clearing
 * account at zero, and a non-zero balance is a list of sales the gateway has
 * not paid out yet - which is a useful control on its own.
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
 * The chart's own note: Shopify never touches Affirm money and those
 * settlements are invisible to the payouts API, so folding Affirm-gateway
 * orders into `1200` means it can never reconcile to zero. `clearingRole` is an
 * input for that reason - one payout drains ONE clearing account.
 *
 * ## Scope
 *
 * There is no payout source in auxx yet (no `payout` entity, no Stripe payout
 * ingest), so the GATHERER for this entry is out of scope. What ships is the
 * pure builder and `postPayoutEntry` - the writer a gatherer will call - with
 * no trigger.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md §1.3
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, type AccountRole, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

/** The `sourceType` every payout line carries. */
export const PAYOUT_SOURCE_TYPE = 'payout'

/** The clearing roles a payout may drain. One role exists today. */
export const PAYOUT_CLEARING_ROLES: readonly AccountRole[] = [ACCOUNT_ROLES.CLEARING_SHOPIFY]

export interface BuildPayoutEntryInput {
  /** The gateway's own payout id. Every line's `sourceId`. */
  payoutId: string
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
  /** What actually reached the bank, integer minor units. */
  netMinor: number
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
 *   arithmetic disagreement, an over-long payout number, or a `clearingRole`
 *   that is not a clearing account.
 */
export function buildPayoutEntry(input: BuildPayoutEntryInput): BuiltPayoutEntry {
  const { payoutId, payoutNumber, clearingRole, paidAt, memo } = input

  const number = payoutNumber.trim()
  if (!number) {
    throw new UnprocessableEntityError(
      'A payout entry needs a short payout number to key its document number on - never a bare ' +
        'gateway id, which is over the 21-character cap, and never a date, because two payouts ' +
        'can settle on one day.',
      { payoutId }
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

  const source = { sourceType: PAYOUT_SOURCE_TYPE, sourceId: payoutId }
  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.CASH,
      direction: 'debit',
      amount: netMinor,
      memo: memo ?? `Payout ${number} - net deposited`,
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

  const entry = buildEntry({
    postingType: 'payout',
    periodKey: number,
    txnDate: paidAt,
    lines,
  })

  return { entry, periodKey: number, grossMinor, feesMinor, netMinor }
}
