// packages/lib/src/money/invoices/write-off.ts
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

import { type Database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import {
  type BuildWriteOffEntryInput,
  buildWriteOffEntry,
  WRITE_OFF_SOURCE_TYPE,
} from '../../postings/build-write-off-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { LEDGER_CURRENCY, postEntry, previewEntry } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { EntryPreview, PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'

/**
 * The one write `invoice_status` guard (`resources/hooks/lifecycle-status-guard.ts`)
 * lets through unchallenged, mirroring `markInvoiceSent`/`voidInvoice`'s
 * `INVOICE_STATUS_BYPASS` (`money/invoice-lifecycle.ts`) - a separate constant
 * here rather than an import, because that one is private to its file and this
 * write path needs the identical single-attribute set for the identical reason.
 */
const INVOICE_STATUS_BYPASS = new Set<SystemAttribute>(['invoice_status'])

const INVOICE_ATTRIBUTES = [
  'invoice_status',
  'invoice_number',
  'invoice_balance',
  'invoice_total',
  'invoice_amount_paid',
  'invoice_written_off',
] as const

interface InvoiceForWriteOff {
  status: string
  number: string
  /** Integer minor units. `0` when the field has never been written. */
  balanceMinor: number
  /** Integer minor units. `0` when the field has never been written. */
  totalMinor: number
  /** Integer minor units. `0` when the field has never been written. */
  amountPaidMinor: number
  /**
   * Cumulative bad debt already taken off this invoice, integer minor units.
   * `0` on an org that has not run entity migration 128 yet, which is also the
   * right answer there: nothing has been written off through a path that could
   * have recorded it.
   */
  writtenOffMinor: number
  /**
   * Whether this org has the `invoice_written_off` field at all - it arrives
   * with entity migration 128, and an org short of it must not be handed a
   * write for a field that does not exist.
   */
  hasWrittenOffField: boolean
  /**
   * What is still sitting in accounts receivable for this invoice, and so the
   * most that may still be written off. See {@link resolveOutstandingMinor}.
   */
  outstandingMinor: number
}

/**
 * The receivable this invoice still carries: `total - amountPaid - writtenOff`.
 *
 * 🛑 **Derived from the totals rather than read off `invoice_balance`, because
 * two writers disagree about that field.** `syncInvoicePaymentState`
 * (`money/payments/ledger.ts`) recomputes it as `total - amountPaid` on every
 * payment event and knows nothing about bad debt, so the reduction a partial
 * write-off makes to it is undone by the next payment sync. Deriving here is
 * stable under that: `writtenOff` only ever grows, and it is never folded into
 * the two numbers it is subtracted from.
 *
 * ⚠️ The fallback, for an invoice with no `total` written yet, is
 * `invoice_balance` verbatim - what this file used before. It cannot subtract
 * `writtenOff` there without double-counting, because with no total nothing
 * re-derives the balance and the reduction this file made to it still stands.
 * An invoice with no total is degenerate anyway: `syncInvoicePaymentState`
 * would compute a negative balance for it.
 */
function resolveOutstandingMinor(parts: {
  totalMinor: number
  amountPaidMinor: number
  writtenOffMinor: number
  balanceMinor: number
}): number {
  const { totalMinor, amountPaidMinor, writtenOffMinor, balanceMinor } = parts
  if (totalMinor > 0) {
    return Math.max(0, totalMinor - amountPaidMinor - writtenOffMinor)
  }
  return Math.max(0, balanceMinor)
}

/**
 * The invoice's status/number/balance, or `null` when it does not exist. A
 * plain `FieldValue` read - no actor needed, so `previewWriteOffInvoice` and
 * `writeOffInvoice` share it without either having to invent one for the
 * other, unlike `UnifiedCrudHandler.getFieldValues`, which requires one.
 */
async function loadInvoiceForWriteOff(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForWriteOff | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...INVOICE_ATTRIBUTES])
  const fieldIds = [
    cf.invoice_status,
    cf.invoice_number,
    cf.invoice_balance,
    cf.invoice_total,
    cf.invoice_amount_paid,
    cf.invoice_written_off,
  ]
    .filter((f) => f !== null)
    .map((f) => f.id)
  if (fieldIds.length === 0) return null

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, invoiceId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
  const byField = new Map(rows.map((row) => [row.fieldId, row]))

  const status = cf.invoice_status ? byField.get(cf.invoice_status.id)?.optionId : undefined
  if (!status) return null

  const number = (cf.invoice_number ? byField.get(cf.invoice_number.id)?.valueText : null) ?? ''
  const numberOf = (field: { id: string } | null): number =>
    (field ? byField.get(field.id)?.valueNumber : null) ?? 0

  const balanceMinor = numberOf(cf.invoice_balance)
  const totalMinor = numberOf(cf.invoice_total)
  const amountPaidMinor = numberOf(cf.invoice_amount_paid)
  const writtenOffMinor = numberOf(cf.invoice_written_off)

  return {
    status,
    number,
    balanceMinor,
    totalMinor,
    amountPaidMinor,
    writtenOffMinor,
    hasWrittenOffField: cf.invoice_written_off !== null,
    outstandingMinor: resolveOutstandingMinor({
      totalMinor,
      amountPaidMinor,
      writtenOffMinor,
      balanceMinor,
    }),
  }
}

/**
 * How many `write_off` postings this invoice has already produced - the
 * `attempt` {@link buildWriteOffEntry} keys on.
 *
 * 🛑 Counted off `GlPostingLine`'s `sourceType`/`sourceId` pair, filtered to the
 * `write_off` posting type, and never off a mirrored column on the invoice: a
 * mirror holds only the latest posting and a reversal clears it, so the count
 * would fall back to zero and the next write-off would re-claim the reversed
 * original's period tuple. The `write_off` filter is what the bank line's
 * equivalent does not need: `sourceType` is `invoice`, which the payment and
 * (soon) invoice-revenue entries also carry, so counting without it would
 * inflate the attempt by every other entry the invoice has ever produced.
 */
async function countWriteOffPostings(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<number> {
  const rows = await db
    .selectDistinct({ glPostingId: schema.GlPosting.id })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'write_off'),
        eq(schema.GlPostingLine.sourceType, WRITE_OFF_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, invoiceId)
      )
    )
  return rows.length
}

/**
 * Refuse a write-off that cannot be made, naming the reason. Shared by
 * {@link previewWriteOffInvoice} and {@link writeOffInvoice} so the two can
 * never disagree about what is refusable before the ledger is ever asked.
 */
function assertWriteOffAllowed(invoice: InvoiceForWriteOff, invoiceId: string): void {
  if (invoice.status === 'void') {
    throw new BadRequestError('Cannot write off a void invoice', { invoiceId })
  }
  if (invoice.status === 'written_off') {
    throw new BadRequestError('This invoice is already written off', { invoiceId })
  }
  if (invoice.status === 'draft') {
    throw new BadRequestError('Cannot write off a draft invoice - send it first', { invoiceId })
  }
  if (invoice.status === 'paid') {
    throw new BadRequestError('This invoice has no balance to write off - it is paid in full', {
      invoiceId,
    })
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

/** Today, in the org's own book time zone - falls back to UTC while setup is incomplete. */
async function todayInBookTimeZone(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  const bookTimeZone = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'UTC'
  return periodKeyForDate(new Date(), 'day', bookTimeZone)
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
  expenseAccountCode?: string
}

/**
 * What a write-off WOULD look like, resolved against the org's own chart.
 * Persists nothing - the dialog's live `EntryJournal`/`EntryBlockers` preview.
 */
export async function previewWriteOffInvoice(
  db: Database,
  input: PreviewWriteOffInput
): Promise<EntryPreview> {
  const { organizationId, invoiceId, amountMinor, expenseAccountCode } = input

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
    expenseAccountCode,
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
  expenseAccountCode?: string
}

/**
 * Write off an invoice's balance (or part of it) to bad debt.
 *
 * Posts `Dr bad_debt_expense (or expenseAccountCode) Cr accounts_receivable`
 * through the ordinary ledger door (`postEntry` - never throws, resolves to a
 * typed refusal the dialog renders as `EntryBlockers`), and only once the post
 * actually lands does it flip `invoice_status` to `written_off`. A refused post
 * (a locked period, an unmapped role) leaves the invoice exactly as it was -
 * there is nothing to roll back, because nothing but the ledger claim wrote
 * anything.
 *
 * ## A PARTIAL write-off can be topped up, and that took two things
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
 *
 * `assertWriteOffAllowed` still refuses a `written_off` invoice before the
 * ledger is ever asked, with a sentence a person can act on: that status means
 * the whole receivable is gone, and only a full write-off sets it.
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
  const { organizationId, actorUserId, invoiceId, amountMinor, reason, expenseAccountCode } = input

  if (!reason || reason.trim().length === 0) {
    throw new BadRequestError('A write-off needs a reason', { invoiceId })
  }

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
    expenseAccountCode,
    memo: reason,
  } satisfies BuildWriteOffEntryInput)

  const lock = await resolvePeriodLock(organizationId)
  const result = await postEntry(db, {
    organizationId,
    entry,
    actorUserId,
    memo: reason,
    lock,
  })

  const posted =
    result.status === 'posted' ||
    result.status === 'already_posted' ||
    result.status === 'not_connected' ||
    result.status === 'disabled'
  if (!posted) return result

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
