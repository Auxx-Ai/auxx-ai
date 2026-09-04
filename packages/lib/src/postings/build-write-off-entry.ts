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
import { assertCompactablePeriodKey, MAX_COMPACT_PERIOD_KEY } from './period-key'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * 36 attempts, which is what the one base-36 character of key budget an
 * attempt costs can hold. The same ceiling, for the same arithmetic, as
 * `banking/review/client.ts`'s `MAX_PERIOD_KEY_ATTEMPT`.
 */
export const MAX_WRITE_OFF_ATTEMPT = 35

/** The `sourceType` a write-off's lines carry - the invoice it accounts for. */
export const WRITE_OFF_SOURCE_TYPE = 'invoice'

/**
 * FNV-1a, 32 bit, folded into `width` base-36 characters.
 *
 * A keyspace, not a secret, so a pure function beats importing `node:crypto`
 * into a builder that has to stay client-safe. Folded with a modulus rather
 * than sliced, so all 32 bits reach the digits that survive. Copied in shape
 * from `banking/review/client.ts` rather than imported: `postings/` must not
 * depend on `banking/`, which depends on it.
 */
function fold36(value: string, width: number): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % 36 ** width).toString(36).toUpperCase().padStart(width, '0')
}

/**
 * Mint the period key for one write-off of one invoice.
 *
 * ## Why the attempt is here at all
 *
 * The key used to be the invoice number and nothing else, which made a PARTIAL
 * write-off silently one-shot: the second one claimed the same
 * `(organizationId, write_off, periodKey, revision = 0)` tuple, `postEntry`
 * answered `already_posted` - a SUCCESS - and nothing posted while the caller
 * reported that it had. The books were short by the second write-off, and only
 * a re-read of `GlPostingLine` would ever have shown it.
 *
 * So a repeat mints a different key, exactly as `bankTransactionPeriodKey` does
 * for a re-coded bank line (HANDOFF §5b departure 3): the caller passes the
 * count of write-off postings already filed against this invoice, and the key
 * carries it. That also makes the document numbers of a serially written-off
 * invoice read in order in the register.
 *
 * ## The shape
 *
 * - **attempt 0** is the invoice number verbatim, byte for byte what this
 *   function returned before the attempt existed. 🛑 That is load-bearing:
 *   `periodKey` is stored on `GlPosting` and is half the uniqueness tuple, so
 *   re-keying it - even to the hyphen-stripped form the document number already
 *   uses - would make every write-off already in a ledger invisible to the
 *   idempotency check and let a duplicate post.
 * - **attempt 1..35** is that number plus one base-36 character, or - when the
 *   number is too long to leave room for one - an eight-character fold of its
 *   compacted form plus that character. Nine compacted characters either way,
 *   which is the whole budget `AUXX-WOF-…-R9` leaves.
 *
 * ⚠️ `buildDocNumber` strips hyphens and nothing else, so there is no separator
 * that survives into the document number and the attempt is simply appended.
 * `INV-0042` attempt 1 therefore mints `INV-00421` and the document number
 * `AUXX-WOF-INV00421`, which an invoice literally numbered `INV-00421` would
 * also mint at attempt 0. Numbers off one sequence are uniform width, so
 * appending a character can never reproduce another one of them; this is the
 * same accepted trade the bank line's key makes, and the
 * alternative - a counted sequence - is the one shape that is actively
 * dangerous here.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long invoice number, or
 *   an attempt past {@link MAX_WRITE_OFF_ATTEMPT}.
 */
export function writeOffPeriodKey(params: {
  invoiceNumber: string
  invoiceId?: string
  /** How many write-off postings this invoice has already produced. */
  attempt?: number
}): string {
  const { invoiceNumber, invoiceId } = params
  const attempt = params.attempt ?? 0

  // 🛑 The cap is checked with the REVERSAL suffix in the budget, not just the
  // key: an invoice number that compacts to twelve characters posts perfectly
  // at revision 0 (`AUXX-WOF-` plus twelve is exactly 21) and then refuses the
  // day somebody reverses it, at 24 - a write-off in the books with no way to
  // take it out. `period-key.ts` owns that arithmetic for every builder.
  const number = assertCompactablePeriodKey({
    value: invoiceNumber,
    label: "The invoice's own number",
    remedy:
      'Shorten the invoice number, or write the amount off with a manual journal entry instead.',
    context: invoiceId ? { invoiceId } : undefined,
  })
  const compact = number.replace(/-/g, '')

  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new UnprocessableEntityError(
      `A write-off period key attempt must be a whole number, got ${String(attempt)}`,
      { invoiceId, invoiceNumber, attempt: String(attempt) }
    )
  }
  if (attempt > MAX_WRITE_OFF_ATTEMPT) {
    throw new UnprocessableEntityError(
      `Invoice ${invoiceNumber} has already had ${attempt} write-off entries posted against it, ` +
        'which is more than the document-number keyspace can hold. Write the remainder off with ' +
        'a manual journal entry instead.',
      { invoiceId, invoiceNumber, attempt: String(attempt) }
    )
  }

  if (attempt === 0) return number

  const room = MAX_COMPACT_PERIOD_KEY - 1
  const base = compact.length <= room ? number : fold36(compact, room)
  return `${base}${attempt.toString(36).toUpperCase()}`
}

export interface BuildWriteOffEntryInput {
  /** The `invoice` EntityInstance id. Becomes every line's `sourceId`. */
  invoiceId: string
  /**
   * The invoice's own number (`'INV-0042'`) - `periodKey` keys on this,
   * compacted by `doc-number.ts` the same way `manual_journal`/`bank_deposit`
   * key on their own record's number.
   */
  invoiceNumber: string
  /**
   * How many write-off postings this invoice has already produced (original
   * plus reversal is 2). Omitted means zero, which is the first write-off.
   *
   * 🛑 **Without this a partial write-off can happen exactly once, ever.** See
   * {@link writeOffPeriodKey}. The caller reads the count off `GlPostingLine`,
   * never off a mirrored column on the invoice, because a mirrored column holds
   * only the latest posting and a reversal clears it.
   */
  attempt?: number
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
 * @throws {UnprocessableEntityError} on a blank or over-long invoice number, an
 *   attempt past {@link MAX_WRITE_OFF_ATTEMPT}, a non-integer, zero or negative
 *   amount, or (via `buildEntry`) an entry that fails to balance - unreachable
 *   here since both legs carry the same amount, but asserted anyway per the
 *   file-header rule every builder in this folder follows.
 */
export function buildWriteOffEntry(input: BuildWriteOffEntryInput): BuiltEntry {
  const { invoiceId, invoiceNumber, attempt, amountMinor, txnDate, expenseAccountCode, memo } =
    input

  const periodKey = writeOffPeriodKey({ invoiceNumber, invoiceId, attempt })

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
    periodKey,
    txnDate,
    lines: [debitLine, creditLine],
  })
}
