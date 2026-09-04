// packages/lib/src/banking/review/build-entry.ts

/**
 * The one entry the bank feed is allowed to post
 * (plans/bank-connection/03-categorization-and-gl.md §3.2, §5).
 *
 * PURE. No database, no clock, no chart. Same input in, same `BuiltEntry` out.
 *
 * ## 🛑 Only a CODED line reaches this file
 *
 * A bank line that corroborates a document auxx already holds LINKS to it and
 * posts nothing (decision **B5**). The reason is the whole point of the bank
 * plan: `buildBillPaymentEntry` and `buildPaymentEntry` already credit cash for
 * that event, so a second entry from the feed credits cash TWICE, both entries
 * balance, the trial balance balances, and nothing in the system detects it. It
 * surfaces months later as a cash account that will not tie.
 *
 * So there are exactly two callers: `codeTransaction`, for a fee or a receipt
 * nobody raised a document for, and `transferTransaction`, whose two legs are
 * both ours and where the alternative is recording an expense and an income
 * that never happened (03 §3.3).
 *
 * ## Why this names accounts by CODE and not by role
 *
 * `G8` makes a builder emit a ROLE because a builder cannot know what number
 * this org gave an account. A person coding a bank line is doing the opposite:
 * they are picking a specific account out of THEIR OWN chart, looking at it as
 * it stands right now. That is the same act as a manual journal entry, and it
 * gets the same shape - `build-manual-entry.ts`'s reasoning applies verbatim.
 * The bank side of the entry is the `bank_account` record's mapped code, which
 * a person also chose, on the settings page.
 *
 * 🛑 **The resolver is not cheaper for being a code.** `resolveAccountLines`
 * validates both codes against the org's chart with the same five refusals, so
 * an unmapped bank account or a typo'd expense code fails closed at
 * `previewEntry` time with a sentence naming the account.
 */

import { UnprocessableEntityError } from '../../errors'
import { buildEntry } from '../../postings/build-entry'
import type { BuiltEntry, GlPostingLineInput } from '../../postings/types'
import { BANK_TRANSACTION_SOURCE_TYPE, bankLineFlow } from './client'

/** The posting type both shapes claim. In both union copies since drizzle 0361. */
export const BANK_TRANSACTION_POSTING_TYPE = 'bank_transaction' as const

export interface BuildCodedBankEntryInput {
  /** The `bank_transaction` record id. Every line's `sourceId`. */
  transactionId: string
  /** `bankTransactionPeriodKey` minted it. Never a cuid, never a bare date. */
  periodKey: string
  /** `YYYY-MM-DD`. The bank's own `postedAt`, never today. */
  txnDate: string
  /** Integer minor units, SIGNED, exactly as the bank said it. */
  amountMinor: number
  /** The account a person coded this line to, from the org's own chart. */
  glAccountCode: string
  /** The `bank_account` record's mapped GL code. The cash side. */
  bankAccountCode: string
  memo?: string
}

/**
 * `Dr <coded account> / Cr <bank account>` for money out, mirrored for money in.
 *
 * 🛑 **The direction rule is the whole correctness of this file.** Money LEAVING
 * the bank debits the expense and credits the bank account, because the bank
 * account is an asset and paying a fee reduces it. Money ARRIVING credits the
 * coded account and debits the bank. Getting this backwards produces an entry
 * that balances perfectly and states the opposite of what happened, which is
 * the class of error the whole postings module is shaped to make loud.
 *
 * ⚠️ **The sign is taken from `amountMinor` and nowhere else,** then discarded:
 * `GlPostingLineInput.amount` is always positive and `direction` is the only
 * carrier of sign (rule `G2`). `bank_transaction.amountMinor` is deliberately
 * the one signed money column in the books because it mirrors a statement, and
 * this function is the boundary where that convention ends.
 *
 * ⚠️ A `credit` bank account (a card) is a LIABILITY, and its signs read the
 * other way round at the bank. That is handled where it belongs - the account's
 * MAPPING, refused onto an asset code by the settings page (`BANK_ACCOUNT_GL_TYPES`)
 * - not here: once the card is mapped to a liability account, a charge on it
 * still debits the expense and credits the card, which is what this produces.
 *
 * @throws {UnprocessableEntityError} on a zero, non-integer or non-finite
 *   amount, on a blank account code either side, or when the two codes are the
 *   same account (an entry that nets to nothing and hides which side was wrong).
 */
export function buildCodedBankEntry(input: BuildCodedBankEntryInput): BuiltEntry {
  const { transactionId, periodKey, txnDate, amountMinor, memo } = input
  const glAccountCode = input.glAccountCode?.trim()
  const bankAccountCode = input.bankAccountCode?.trim()

  assertPostableAmount(amountMinor)
  if (!glAccountCode) {
    throw new UnprocessableEntityError(
      'Coding a bank line has to name the account it belongs in. Pick one from the chart.'
    )
  }
  if (!bankAccountCode) {
    throw new UnprocessableEntityError(
      'This bank account is not mapped to a GL account, so there is nothing to credit. ' +
        'Map it on Accounting > Settings > Bank accounts first.'
    )
  }
  if (glAccountCode === bankAccountCode) {
    throw new UnprocessableEntityError(
      `Coding this line to ${glAccountCode} would debit and credit the same account, which ` +
        'nets to nothing. Pick the expense or income account the money actually belongs in.'
    )
  }

  const amount = Math.abs(amountMinor)
  const outbound = bankLineFlow(amountMinor) === 'out'
  const lines: GlPostingLineInput[] = [
    line(outbound ? glAccountCode : bankAccountCode, 'debit', amount, transactionId, memo, 0),
    line(outbound ? bankAccountCode : glAccountCode, 'credit', amount, transactionId, memo, 1),
  ]

  return buildEntry({
    postingType: BANK_TRANSACTION_POSTING_TYPE,
    periodKey,
    txnDate,
    lines,
  })
}

export interface BuildTransferEntryInput {
  /** The OUTGOING leg's `bank_transaction` record id. The entry is filed on it. */
  transactionId: string
  periodKey: string
  txnDate: string
  /** Integer minor units, signed, off the leg the entry is filed on. */
  amountMinor: number
  /** The GL code of the account the money LEFT. */
  fromAccountCode: string
  /** The GL code of the account the money ARRIVED in. */
  toAccountCode: string
  memo?: string
}

/**
 * `Dr <to account> / Cr <from account>` - cash to cash, once.
 *
 * 🛑 **Never a revenue or expense account, and never two entries.** A move from
 * checking to a card appears as two bank lines, one on each account. Coded as
 * ordinary transactions the business records an expense and an income that never
 * happened; posted twice, cash moves twice. So the pair produces exactly ONE
 * entry, filed on the outgoing leg, and both legs are marked matched to each
 * other.
 *
 * ⚠️ A card payment (checking to credit card) is a transfer, not an expense, and
 * it is the case that bites first because a business with both feeds sees it
 * every month.
 *
 * @throws {UnprocessableEntityError} on a zero or non-integer amount, a blank
 *   code either side, or the same account on both sides.
 */
export function buildTransferEntry(input: BuildTransferEntryInput): BuiltEntry {
  const { transactionId, periodKey, txnDate, amountMinor, memo } = input
  const fromAccountCode = input.fromAccountCode?.trim()
  const toAccountCode = input.toAccountCode?.trim()

  assertPostableAmount(amountMinor)
  if (!fromAccountCode || !toAccountCode) {
    throw new UnprocessableEntityError(
      'A transfer needs both accounts mapped to a GL account. Map them on ' +
        'Accounting > Settings > Bank accounts first.'
    )
  }
  if (fromAccountCode === toAccountCode) {
    throw new UnprocessableEntityError(
      `Both sides of this transfer resolve to ${fromAccountCode}. Two bank accounts mapped to ` +
        'one GL code cannot be reconciled apart - map them to separate accounts.'
    )
  }

  const amount = Math.abs(amountMinor)
  return buildEntry({
    postingType: BANK_TRANSACTION_POSTING_TYPE,
    periodKey,
    txnDate,
    lines: [
      line(toAccountCode, 'debit', amount, transactionId, memo, 0),
      line(fromAccountCode, 'credit', amount, transactionId, memo, 1),
    ],
  })
}

/** One code line, in the shape `GlPostingLineInput`'s code leg takes. */
function line(
  accountCode: string,
  direction: 'debit' | 'credit',
  amount: number,
  sourceId: string,
  memo: string | undefined,
  sortOrder: number
): GlPostingLineInput {
  return {
    accountCode,
    direction,
    amount,
    memo,
    sourceType: BANK_TRANSACTION_SOURCE_TYPE,
    sourceId,
    sortOrder,
  }
}

/**
 * A bank line that can become an entry at all.
 *
 * 🛑 Zero is refused rather than posted as a balanced pair of zeroes. A $0 line
 * is a bank artefact - a reversed authorisation, a waived fee - and an entry for
 * it claims an economic event that did not happen while passing every balance
 * check there is.
 */
function assertPostableAmount(amountMinor: number): void {
  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor)) {
    throw new UnprocessableEntityError(
      `This line's amount is ${String(amountMinor)}, which is not a whole number of cents.`
    )
  }
  if (amountMinor === 0) {
    throw new UnprocessableEntityError(
      'This line moved no money, so there is nothing to post. Exclude it instead.'
    )
  }
}
