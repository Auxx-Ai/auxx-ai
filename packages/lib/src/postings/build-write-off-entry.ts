// packages/lib/src/postings/build-write-off-entry.ts
//
// PURE. Turns an invoice write-off into a balanced posting line. No database,
// no clock, no chart - the property every other builder in this folder has.
//
// `Dr bad_debt_expense  Cr accounts_receivable`, both by ROLE (decision G8) -
// unless the bookkeeper overrides the debit leg with an account CODE out of
// their own chart, the same escape hatch `build-manual-entry.ts` gives a
// hand-authored line. `accounts_receivable` is never overridable: the credit
// leg is always the ONE receivable role (handoff decision 6.1), because a
// write-off that named a different receivable account would leave the
// invoice's own A/R balance untouched.
//
// plans/accounting/HANDOFF.md slot 2K; gap-analysis.md §3 item 9.

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * `AUXX-WOF-` is nine characters and a reversal adds `-R<n>`, so the compacted
 * invoice number has to leave room for both inside the 21-character cap.
 *
 * 🛑 Checked HERE rather than left to `buildDocNumber`, which only ever sees
 * revision 0 on the way in. Without this an invoice number that compacts to
 * twelve characters posts perfectly - `AUXX-WOF-` plus twelve is exactly 21 -
 * and then REFUSES the day somebody reverses it, at 24. The write-off would be
 * in the books with no way to take it out, which is the worst possible moment
 * to discover a keyspace limit. Same guard, same reasoning, as
 * `build-payout-entry.ts` and `build-fulfillment-entry.ts`.
 */
const MAX_COMPACT_PERIOD_KEY = DOC_NUMBER_MAX_LENGTH - 'AUXX-WOF-'.length - '-R9'.length

/** The `sourceType` a write-off's lines carry - the invoice it accounts for. */
export const WRITE_OFF_SOURCE_TYPE = 'invoice'

export interface BuildWriteOffEntryInput {
  /** The `invoice` EntityInstance id. Becomes every line's `sourceId`. */
  invoiceId: string
  /**
   * The invoice's own number (`'INV-0042'`) - `periodKey` keys on this,
   * compacted by `doc-number.ts` the same way `manual_journal`/`bank_deposit`
   * key on their own record's number. A re-write-off of the SAME invoice
   * therefore claims the same `(org, write_off, periodKey, revision=0)` key and
   * comes back `already_posted` - by design, one write-off per invoice; a
   * correction is a reversal (a higher revision), not a second original.
   */
  invoiceNumber: string
  /** Integer minor units, > 0. The amount moved off accounts receivable. */
  amountMinor: number
  /** `YYYY-MM-DD`. The accounting date. */
  txnDate: string
  /**
   * An account CODE out of the org's own chart, overriding the debit leg.
   * Omit to use the `bad_debt_expense` role (the ordinary case).
   */
  expenseAccountCode?: string
  memo?: string
}

/**
 * Build the write-off entry for one invoice.
 *
 * ```
 * Dr <bad_debt_expense role, or expenseAccountCode>   amountMinor
 *   Cr accounts_receivable                             amountMinor
 * ```
 *
 * @throws {UnprocessableEntityError} on a blank or over-long invoice number, a
 *   non-integer, zero or negative amount, or (via `buildEntry`) an entry that fails to
 *   balance - unreachable here since both legs carry the same amount, but
 *   asserted anyway per the file-header rule every builder in this folder
 *   follows.
 */
export function buildWriteOffEntry(input: BuildWriteOffEntryInput): BuiltEntry {
  const { invoiceId, invoiceNumber, amountMinor, txnDate, expenseAccountCode, memo } = input

  if (!invoiceNumber || invoiceNumber.trim().length === 0) {
    throw new UnprocessableEntityError(
      "A write-off needs the invoice's own number to key its document number on",
      { invoiceId }
    )
  }
  const compactNumber = invoiceNumber.trim().replace(/-/g, '')
  if (compactNumber.length > MAX_COMPACT_PERIOD_KEY) {
    throw new UnprocessableEntityError(
      `Invoice number "${invoiceNumber}" compacts to ${compactNumber.length} characters and a ` +
        `write-off's document number allows ${MAX_COMPACT_PERIOD_KEY} (21 characters total, less ` +
        '"AUXX-WOF-" and a reversal suffix). Shorten the invoice number, or write the amount off ' +
        'with a manual journal entry instead.',
      { invoiceId, invoiceNumber, length: String(compactNumber.length) }
    )
  }
  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor)) {
    throw new UnprocessableEntityError(
      `Write-off amount must be an integer number of minor units, got ${String(amountMinor)}`,
      { invoiceId, invoiceNumber }
    )
  }
  if (amountMinor <= 0) {
    throw new UnprocessableEntityError(`Write-off amount must be positive, got ${amountMinor}`, {
      invoiceId,
      invoiceNumber,
    })
  }

  const lineMemo = memo ?? `Write off ${invoiceNumber}`
  const source = { sourceType: WRITE_OFF_SOURCE_TYPE, sourceId: invoiceId }

  const debitLine: GlPostingLineInput = expenseAccountCode
    ? {
        accountCode: expenseAccountCode,
        direction: 'debit',
        amount: amountMinor,
        memo: lineMemo,
        sortOrder: 0,
        ...source,
      }
    : {
        accountRole: ACCOUNT_ROLES.BAD_DEBT_EXPENSE,
        direction: 'debit',
        amount: amountMinor,
        memo: lineMemo,
        sortOrder: 0,
        ...source,
      }

  const creditLine: GlPostingLineInput = {
    accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
    direction: 'credit',
    amount: amountMinor,
    memo: lineMemo,
    sortOrder: 1,
    ...source,
  }

  return buildEntry({
    postingType: 'write_off',
    periodKey: invoiceNumber,
    txnDate,
    lines: [debitLine, creditLine],
  })
}
