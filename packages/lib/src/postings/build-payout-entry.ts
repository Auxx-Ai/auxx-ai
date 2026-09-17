// packages/lib/src/postings/build-payout-entry.ts

/**
 * The payout entry: a gateway's settlement, gross minus fees, landing as one
 * bank deposit days after the sales it settles.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr bank                     the whole deposit that reached the bank, [rail, currency]
 *   Dr payment_processing_fees  fees withheld on the RECOGNISED charges, [rail, currency]
 *       Cr clearing             RECOGNISED gross,                        [rail, currency]
 *       Cr unidentified_receipts  the unrecognised remainder, net
 * ```
 *
 * This is the entry that makes clearing reconcilable. A card receipt DEBITS
 * the clearing account gross at the sale, and this entry credits it gross
 * again, net to the bank account the payout settled into and the difference to
 * fees. A settled batch therefore leaves the rail's clearing account at zero,
 * and a non-zero balance is a list of sales the gateway has not paid out yet -
 * which is a useful control on its own.
 *
 * ## Every leg is a role line, scoped to the rail (task 58 §5.3)
 *
 * `bank`, `payment_processing_fees`, `clearing` and `unidentified_receipts` are
 * ALL emitted as `{ accountRole, sourceScope: { rail, currency } }`. There is no
 * id-routing left in this builder - the rail scope IS what makes the debit
 * (a fulfillment or receipt, scoped the same way) and this credit meet in one
 * account, and `resolveRoles` (task 58 §5.1) is what turns the role into a
 * `gl_account`. `bank` has no org-wide default (`ROLES_WITHOUT_DEFAULT`): a
 * miss on the rail scope fails closed rather than falling back anywhere, which
 * is `postPayoutEntry`'s job to word (task 58 §5.4 rule 1) - this file only
 * emits the line.
 *
 * There is no fallback for a payout with no rail, because a payout without a
 * rail cannot exist: it was read by a source that is linked to one (§5.5).
 * {@link BuildPayoutEntryInput.rail} and {@link BuildPayoutEntryInput.currency}
 * are therefore both required, not optional.
 *
 * And {@link BuildPayoutEntryInput.feeTreatment} decides whether there is a fee
 * leg AT ALL: a `billed` rail deposits gross and invoices for its fees weeks
 * later (§4), so `gross === net` is the expected arithmetic there.
 *
 * ## The fourth leg, and why it is not optional
 *
 * A gateway payout settles EVERY charge the merchant took, including charges
 * taken outside auxx - a payment link sent from the Stripe dashboard, a
 * subscription on the same account, a terminal. Those were never debited to
 * `clearing`, so crediting the payout's full gross to clearing drives that
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
 *   (`unidentified_receipts`) rather than silently distorting either.
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
 * ## The gatherer
 *
 * `money/payouts/gather.ts` is the read that fills this input from a
 * {@link PayoutSource}, and `money/payouts/sync.ts` is what walks an org's
 * payouts and posts them.
 *
 * @see plans/accounting/tasks/58-one-mapping-table.md §5.3
 */

import { UnprocessableEntityError } from '../errors'
import type { PaymentGatewayFeeTreatmentValue } from '../payment-gateways/client'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
import type { BuiltEntry, GlPostingLineInput, RoleSourceScope } from './types'

/** The `sourceType` every payout line carries. */
export const PAYOUT_SOURCE_TYPE = 'payout'

export interface BuildPayoutEntryInput {
  /** The gateway's own payout id. Every line's `sourceId`. */
  payoutId: string
  /**
   * The `payment_gateway` `EntityInstance` id this payout settled - every
   * line's rail scope (task 58 §5.3). Required: a payout with no rail cannot
   * exist, because it was read by a source that is linked to one (§5.5).
   */
  rail: string
  /** The settlement currency, alongside {@link rail} on every scoped line. */
  currency: string
  /**
   * The short, human key the document number is built on.
   *
   * 🛑 **`doc-number.ts` says `payout` keys on the payout id, and that rule
   * only works while the id is short.** Shopify can issue two payouts in a day,
   * so a DATE key would merge them into one entry whose total ties to neither
   * deposit - and reconciling clearing is exactly what would then be
   * impossible. A Stripe `po_…` id is 27 characters and blows the
   * 21-character cap, so the caller passes a short number when it has one and
   * the id when it is short enough; this function refuses the rest, naming the
   * length.
   */
  payoutNumber: string
  /** Total sales settled, integer minor units. Equals `net + fees`. */
  grossMinor: number
  /** What the processor withheld, integer minor units. May be zero. */
  feesMinor: number
  /**
   * What actually reached the bank, integer minor units. The RECOGNISED net -
   * `grossMinor - feesMinor` - NOT the payout's total. The whole deposit is
   * `netMinor + unrecognisedNetMinor`, and that is what lands on the `bank`
   * line.
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
  /**
   * How the rail charges for itself (brief 26 §4). Defaults to `netted`, which
   * is what this builder has always assumed.
   *
   * 🛑 **`billed` drops the fee leg entirely.** A traditional acquirer on
   * statement billing deposits GROSS and invoices for the fees weeks later, so
   * a fee leg inside the settlement entry is simply wrong: it would debit an
   * expense the deposit never carried and leave the clearing account short by
   * the same amount. `gross === net` is then the EXPECTED arithmetic rather than
   * a mis-read payout.
   */
  feeTreatment?: PaymentGatewayFeeTreatmentValue
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
 *   arithmetic disagreement, a withheld fee on a `billed` rail, an over-long
 *   payout number, or a missing rail or currency.
 */
export function buildPayoutEntry(input: BuildPayoutEntryInput): BuiltPayoutEntry {
  const { payoutId, payoutNumber, paidAt, memo } = input
  const rail = input.rail?.trim()
  const currency = input.currency?.trim()
  const feeTreatment = input.feeTreatment ?? 'netted'

  const number = payoutNumber.trim()
  if (!number) {
    throw new UnprocessableEntityError(
      'A payout entry needs a short payout number to key its document number on - never a bare ' +
        'gateway id, which is over the 21-character cap, and never a date, because two payouts ' +
        'can settle on one day.',
      { payoutId }
    )
  }
  if (!rail) {
    throw new UnprocessableEntityError(
      `Payout ${number} has no rail. A payout with no rail cannot exist - it was read by a ` +
        'source that is linked to one.',
      { payoutId, payoutNumber: number }
    )
  }
  if (!currency) {
    throw new UnprocessableEntityError(`Payout ${number} has no settlement currency.`, {
      payoutId,
      payoutNumber: number,
    })
  }
  const compact = number.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    throw new UnprocessableEntityError(
      `Payout number "${number}" compacts to ${compact.length} characters and the document number ` +
        `allows ${MAX_COMPACT_PERIOD_KEY}. Key on a short payout number rather than the gateway's id.`,
      { payoutId, payoutNumber: number, length: String(compact.length) }
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
  // 🛑 A billed rail's deposit is GROSS: the processor bills for its cut weeks
  // later, so a settlement that reports a withheld fee is describing a netted
  // rail and this record says otherwise. Refusing names the disagreement;
  // dropping the fee silently would leave the clearing account short by it
  // forever, in an entry that balances.
  if (feeTreatment === 'billed' && feesMinor !== 0) {
    throw new UnprocessableEntityError(
      `Payout ${number} reports ${feesMinor} of withheld fees, but its gateway bills its fees ` +
        'separately, so the deposit should be gross. Either the payout was mis-read or the ' +
        "gateway's fee treatment should be netted.",
      { payoutNumber: number, feesMinor: String(feesMinor), feeTreatment }
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
  /** Every leg reads its account through this same rail scope (task 58 §5.3). */
  const sourceScope: RoleSourceScope = { rail, currency }
  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.BANK,
      sourceScope,
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
  // Dropped ENTIRELY on a billed rail, which is a different statement: there is
  // no fee in this settlement to post at any amount.
  if (feeTreatment !== 'billed' && feesMinor !== 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
      sourceScope,
      direction: 'debit',
      amount: feesMinor,
      memo: `Payout ${number} - processor fees withheld`,
      sortOrder: 1,
    })
  }
  lines.push({
    ...source,
    accountRole: ACCOUNT_ROLES.CLEARING,
    sourceScope,
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
      sourceScope,
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
