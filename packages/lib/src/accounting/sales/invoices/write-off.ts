// packages/lib/src/accounting/sales/invoices/write-off.ts
//
// Writing off an invoice's remaining balance to bad debt: read the invoice,
// default and validate the amount, post `Dr bad_debt_expense Cr accounts_receivable`
// through the ledger, and - only once that succeeds - flip `invoice_status` to
// `written_off`.
//
// plans/accounting/HANDOFF.md slot 2K; gap-analysis.md §3 item 9.
//
// Sibling to `money/invoice-lifecycle.ts` (`markInvoiceSent`/`voidInvoice`) and
// `money/payments/ledger.ts` (`recordManualPayment`/`syncInvoicePaymentState`)
// in shape and in convention: throws `AuxxError` subclasses directly rather than
// returning a `neverthrow` `Result` - the money module's local style for an
// invoice action, not the newer `Result<T, Error>` convention `docs/lib-module-guide.md`
// asks of new lib code in general. No permission checks here - the router
// asserts `ledgerPost` (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { BadRequestError, NotFoundError } from '../../../errors'
import { FieldValueService } from '../../../field-values/field-value-service'
import { type BuildWriteOffEntryInput, buildWriteOffEntry } from '../../ledger/builders/write-off'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { isExpectedPostOutcome } from '../../ledger/post/ledger-accepted'
import { LEDGER_CURRENCY, previewEntry } from '../../ledger/post/post-entry'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { EntryPreview, PostResult } from '../../ledger/types'
import { acceptInvoiceWriteOffAccounting } from './write-off-accounting'
import {
  countWriteOffPostings,
  type InvoiceForWriteOff,
  loadInvoiceForWriteOff,
} from './write-off-reads'

/**
 * The one write `invoice_status` guard (`resources/hooks/lifecycle-status-guard.ts`)
 * lets through unchallenged, mirroring `markInvoiceSent`/`voidInvoice`'s
 * `INVOICE_STATUS_BYPASS` (`money/invoice-lifecycle.ts`) - a separate constant
 * here rather than an import, because that one is private to its file and this
 * write path needs the identical single-attribute set for the identical reason.
 */
const INVOICE_STATUS_BYPASS = new Set<SystemAttribute>(['invoice_status'])

/**
 * Refuse a write-off that cannot be made, naming the reason. Shared by
 * {@link previewWriteOffInvoice} and {@link writeOffInvoice} so the two can
 * never disagree about what is refusable before the ledger is ever asked.
 */
function assertWriteOffAllowed(invoice: InvoiceForWriteOff, invoiceId: string): void {
  if (invoice.status === 'void') {
    throw new BadRequestError('Cannot write off a void invoice', { invoiceId })
  }
  if (invoice.status === 'draft') {
    throw new BadRequestError('Cannot write off a draft invoice - send it first', { invoiceId })
  }
  // 🛑 "Nothing left to write off" is decided by the DERIVED outstanding figure,
  // never by the status. `written_off` and `paid` are each meant to imply a zero
  // receivable, but neither is a reliable statement of one:
  // `syncInvoicePaymentState` rewrites the balance mirror on every payment event
  // knowing nothing about bad debt, and a row written off before entity
  // migration 128 can carry `written_off` while a real receivable is still on it.
  //
  // ⚠️ Refusing on the status alone is what made {@link readWriteOffState} and
  // this function disagree: the dialog opened prefilled with the remainder that
  // read is built to compute, and every preview and post against it then failed
  // with "already written off". Found in a browser, not by a test, because both
  // halves are individually correct - only the pair is wrong. Both now key on
  // `outstandingMinor`, so the screen cannot offer what this will refuse.
  if (invoice.outstandingMinor <= 0) {
    throw new BadRequestError(
      invoice.status === 'written_off'
        ? 'This invoice has no balance to write off - it is already written off in full'
        : 'This invoice has no balance to write off - it is paid in full',
      { invoiceId }
    )
  }
  if (!invoice.number || invoice.number.trim().length === 0) {
    throw new BadRequestError(
      'This invoice has no number yet, and a write-off needs one to key its document number on',
      { invoiceId }
    )
  }
}

/**
 * Resolve the amount to write off: the caller's, or everything still
 * outstanding.
 *
 * 🛑 Bounded by what is STILL outstanding, not by the invoice's gross balance,
 * so a second write-off can never take the same receivable off A/R twice. "Write
 * off the rest" after a partial one therefore writes off the remainder, not the
 * whole invoice again.
 */
function resolveWriteOffAmount(
  invoice: InvoiceForWriteOff,
  invoiceId: string,
  amountMinor: number | undefined
): number {
  const amount = amountMinor ?? invoice.outstandingMinor
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new BadRequestError(`Write-off amount must be a whole number of cents, got ${amount}`, {
      invoiceId,
    })
  }
  if (amount <= 0) {
    throw new BadRequestError('There is no balance to write off on this invoice', { invoiceId })
  }
  if (amount > invoice.outstandingMinor) {
    const alreadyWrittenOff =
      invoice.writtenOffMinor > 0
        ? ` (${invoice.writtenOffMinor} of it has already been written off)`
        : ''
    throw new BadRequestError(
      `Write-off of ${amount} exceeds the ${invoice.outstandingMinor} still outstanding on ` +
        `invoice ${invoice.number}${alreadyWrittenOff}. Write off the remainder instead, or ` +
        'reverse the earlier write-off first.',
      {
        invoiceId,
        invoiceNumber: invoice.number,
        amountMinor: String(amount),
        outstandingMinor: String(invoice.outstandingMinor),
        writtenOffMinor: String(invoice.writtenOffMinor),
      }
    )
  }
  return amount
}

export interface WriteOffState {
  /** The invoice's own number, or `''` when it has none yet. */
  invoiceNumber: string
  /** The mirrored `invoice_balance`, integer minor units. */
  balanceMinor: number
  /** Cumulative bad debt already taken off, integer minor units. */
  writtenOffMinor: number
  /**
   * The most that may still be written off, integer minor units. **The prefill
   * and the bound a dialog should use, not `balanceMinor`** - the mirrored
   * balance reads high after a partial write-off, because
   * `syncInvoicePaymentState` re-derives it as `total - amountPaid` and knows
   * nothing about bad debt.
   */
  outstandingMinor: number
}

/**
 * What is left to write off on one invoice, and what has already gone.
 *
 * Read-only, and separate from {@link previewWriteOffInvoice} because the
 * preview needs an amount to build an entry from and this is what tells the
 * caller which amount to ask for.
 *
 * @throws {NotFoundError} when the invoice does not exist.
 */
export async function readWriteOffState(
  db: Database,
  params: { organizationId: string; invoiceId: string }
): Promise<WriteOffState> {
  const invoice = await loadInvoiceForWriteOff(db, params.organizationId, params.invoiceId)
  if (!invoice) throw new NotFoundError('Invoice not found', { invoiceId: params.invoiceId })
  return {
    invoiceNumber: invoice.number,
    balanceMinor: invoice.balanceMinor,
    writtenOffMinor: invoice.writtenOffMinor,
    outstandingMinor: invoice.outstandingMinor,
  }
}

export interface PreviewWriteOffInput {
  organizationId: string
  invoiceId: string
  amountMinor?: number
  expenseGlAccountId?: string
}

/**
 * What a write-off WOULD look like, resolved against the org's own chart.
 * Persists nothing - the dialog's live `EntryJournal`/`EntryBlockers` preview.
 */
export async function previewWriteOffInvoice(
  db: Database,
  input: PreviewWriteOffInput
): Promise<EntryPreview> {
  const { organizationId, invoiceId, amountMinor, expenseGlAccountId } = input

  const invoice = await loadInvoiceForWriteOff(db, organizationId, invoiceId)
  if (!invoice) throw new NotFoundError('Invoice not found', { invoiceId })
  assertWriteOffAllowed(invoice, invoiceId)
  const amount = resolveWriteOffAmount(invoice, invoiceId, amountMinor)

  const [txnDate, attempt] = await Promise.all([
    todayInBookTimeZone(organizationId),
    countWriteOffPostings(db, organizationId, invoiceId),
  ])
  const entry = buildWriteOffEntry({
    invoiceId,
    invoiceNumber: invoice.number,
    attempt,
    amountMinor: amount,
    txnDate,
    expenseGlAccountId,
    contactInstanceId: invoice.contactInstanceId,
  } satisfies BuildWriteOffEntryInput)

  const lock = await resolvePeriodLock(organizationId)
  return previewEntry(db, { organizationId, entry, lock })
}

export interface WriteOffInvoiceInput {
  organizationId: string
  actorUserId: string
  invoiceId: string
  /** Integer minor units. Defaults to everything still outstanding. */
  amountMinor?: number
  reason: string
  expenseGlAccountId?: string
}

/**
 * Write off an invoice's balance (or part of it) to bad debt.
 *
 * Posts `Dr bad_debt_expense (or expenseGlAccountId) Cr accounts_receivable`
 * through {@link acceptInvoiceWriteOffAccounting} - never throws, resolves to a
 * typed refusal the dialog renders as `EntryBlockers` - and only once the post
 * actually lands does it flip `invoice_status` to `written_off`. A refused post
 * (a locked period, an unmapped role) leaves the invoice exactly as it was -
 * there is nothing to roll back, because nothing but the ledger claim wrote
 * anything.
 *
 * ## A PARTIAL write-off can be topped up, and that took three things
 *
 * `periodKey` used to be the invoice number and nothing else, so a second
 * write-off claimed the same `(org, write_off, periodKey, revision = 0)` tuple,
 * `postEntry` answered `already_posted` - a SUCCESS - and nothing posted while
 * this function returned as though it had. The books were short by the second
 * write-off with no error anywhere.
 *
 * 1. **The key carries an attempt** (`countWriteOffPostings` supplies it), the
 *    same departure `bankTransactionPeriodKey` made for a re-coded bank line.
 *    A genuine retry of the same first write-off still converges to
 *    `already_posted`; a SECOND write-off mints its own key and posts.
 * 2. **`invoice_written_off` records the cumulative amount** (entity migration
 *    128), so the next write-off knows what is left and
 *    {@link resolveWriteOffAmount} can refuse one that would exceed it. Before
 *    it, the only trace was a reduction of `invoice_balance` that the next
 *    `syncInvoicePaymentState` re-derived away.
 * 3. **The accounting obligation carries the attempt too** (D19). The same
 *    attempt is the OCCURRENCE of the `invoice_write_off` `AccountingWork`, and
 *    `AccountingWork_fulfillment_original_key` is narrowed so one invoice may
 *    hold several originals of this kind. 🛑 A top-up is deliberately NOT
 *    `operation: 'correction'`: the March write-off was not a mistake, and
 *    calling it one would move July's bad debt into March.
 *
 * `assertWriteOffAllowed` refuses on the DERIVED outstanding figure rather than
 * on the status, so an invoice a partial write-off left with a receivable is
 * still writable no matter what its status says. Only a full write-off sets
 * `written_off`, but rows written off before entity migration 128 can carry that
 * status with a balance still on them, and refusing those made the dialog offer
 * an amount every preview and post then rejected.
 *
 * ⚠️ Still owed, in a file this does not own: `syncInvoicePaymentState`
 * computes `balance = total - amountPaid` and knows nothing about
 * `invoice_written_off`, so the mirrored balance reads high again after the
 * next payment event. Nothing decides anything on that field any more - this
 * file derives its own outstanding figure - but the number on screen is wrong
 * until `money/payments/ledger.ts` subtracts it too.
 */
export async function writeOffInvoice(
  db: Database,
  input: WriteOffInvoiceInput
): Promise<PostResult> {
  const { organizationId, actorUserId, invoiceId, amountMinor, reason, expenseGlAccountId } = input

  if (!reason || reason.trim().length === 0) {
    throw new BadRequestError('A write-off needs a reason', { invoiceId })
  }

  const invoice = await loadInvoiceForWriteOff(db, organizationId, invoiceId)
  if (!invoice) throw new NotFoundError('Invoice not found', { invoiceId })
  assertWriteOffAllowed(invoice, invoiceId)
  const amount = resolveWriteOffAmount(invoice, invoiceId, amountMinor)

  // 🛑 The org's own accounting-off case is checked FIRST, before the reads and
  // the build that exist only to post an entry (task 17 section 3): a write-off
  // must land on the invoice's balance whether or not the org has ever turned
  // accounting on. `acceptInvoiceWriteOffAccounting` checks the same gate again
  // - it is the trigger the gate belongs to - and this early exit is what keeps
  // an accounting-off org from paying for a transaction it will not use.
  const result: PostResult = (await isAccountingEnabled(db, organizationId))
    ? await acceptInvoiceWriteOffAccounting(db, {
        organizationId,
        invoiceId,
        amountMinor: amount,
        reason,
        actorUserId,
        expenseGlAccountId,
      })
    : { status: 'not_enabled' }

  // ⚠️ This list used to be written out here and was missing `healed` AND
  // `not_exported` - a write-off on a healed claim, or on any posting type that
  // ever routes to `'none'`, returned before stamping the invoice. The shared
  // predicate carries both.
  if (!isExpectedPostOutcome(result)) return result

  const remainingBalanceMinor = invoice.outstandingMinor - amount

  // 🛑 `written_off` is a statement about the WHOLE invoice, so only a write-off
  // that clears the whole balance may set it. A partial write-off that stamped it
  // would say the invoice is settled while a real balance is still owed: it would
  // drop out of A/R aging, and `assertWriteOffAllowed` would then refuse to write
  // off the remainder ("already written off") - the balance would be unreachable
  // by every door at once. A partial write-off keeps the status it had (`sent` or
  // `partially_paid`, both of which still read as owed) and moves only the
  // balance and the cumulative written-off figure.
  //
  // `invoice_written_off` is what makes the NEXT write-off correct: it is the
  // one durable record of the bad debt taken, and it only ever grows.
  const values: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'invoice_balance', value: remainingBalanceMinor },
  ]
  if (invoice.hasWrittenOffField) {
    values.push({ fieldId: 'invoice_written_off', value: invoice.writtenOffMinor + amount })
  }
  if (remainingBalanceMinor <= 0) {
    values.unshift({ fieldId: 'invoice_status', value: 'written_off' })
  }

  const fieldValueService = new FieldValueService(organizationId, actorUserId, db, undefined, {
    bypassFieldGuards: INVOICE_STATUS_BYPASS,
  })
  await fieldValueService.setValuesForEntity({
    recordId: toRecordId('invoice', invoiceId),
    values,
  })

  return result
}

// LEDGER_CURRENCY is re-exported for callers that need to label the amount
// they are about to write off before this module's own currency assumption -
// USD for the cutover, per `post-entry.ts` - changes.
export { LEDGER_CURRENCY }
