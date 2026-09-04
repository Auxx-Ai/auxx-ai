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

const INVOICE_ATTRIBUTES = ['invoice_status', 'invoice_number', 'invoice_balance'] as const

interface InvoiceForWriteOff {
  status: string
  number: string
  /** Integer minor units. `0` when the field has never been written. */
  balanceMinor: number
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
  const fieldIds = [cf.invoice_status, cf.invoice_number, cf.invoice_balance]
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
  const balanceMinor =
    (cf.invoice_balance ? byField.get(cf.invoice_balance.id)?.valueNumber : null) ?? 0

  return { status, number, balanceMinor }
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

/** Resolve the amount to write off: the caller's, or the invoice's whole balance. */
function resolveWriteOffAmount(
  invoice: InvoiceForWriteOff,
  invoiceId: string,
  amountMinor: number | undefined
): number {
  const amount = amountMinor ?? invoice.balanceMinor
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new BadRequestError(`Write-off amount must be a whole number of cents, got ${amount}`, {
      invoiceId,
    })
  }
  if (amount <= 0) {
    throw new BadRequestError('There is no balance to write off on this invoice', { invoiceId })
  }
  if (amount > invoice.balanceMinor) {
    throw new BadRequestError(
      `Write-off amount exceeds the invoice balance of ${invoice.balanceMinor}`,
      { invoiceId, amountMinor: String(amount), balanceMinor: String(invoice.balanceMinor) }
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

  const txnDate = await todayInBookTimeZone(organizationId)
  const entry = buildWriteOffEntry({
    invoiceId,
    invoiceNumber: invoice.number,
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
  /** Integer minor units. Defaults to the invoice's whole balance. */
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
 * 🛑 One write-off per invoice, by construction: `buildWriteOffEntry` keys
 * `periodKey` on the invoice's own number, so a second call claims the same
 * `(org, write_off, periodKey, revision=0)` key and comes back `already_posted`
 * - which is also why `assertWriteOffAllowed` refuses a `written_off` invoice
 * before the ledger is ever asked, with a sentence a person can act on instead
 * of a document-number collision.
 *
 * ⚠️ A PARTIAL write-off therefore posts once and cannot be topped up: the
 * remainder's entry would claim the same key. It leaves the status alone (there
 * is still a balance owed) and moves `invoice_balance` only - and that reduction
 * is re-derived away by the next `syncInvoicePaymentState`, which computes the
 * balance from the payment ledger and knows nothing about bad debt. Both need
 * the written-off amount stored on the invoice to fix properly, which is an
 * entity migration this slot does not own.
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

  const txnDate = await todayInBookTimeZone(organizationId)
  const entry = buildWriteOffEntry({
    invoiceId,
    invoiceNumber: invoice.number,
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

  const remainingBalanceMinor = invoice.balanceMinor - amount

  // 🛑 `written_off` is a statement about the WHOLE invoice, so only a write-off
  // that clears the whole balance may set it. A partial write-off that stamped it
  // would say the invoice is settled while a real balance is still owed: it would
  // drop out of A/R aging, and `assertWriteOffAllowed` would then refuse to write
  // off the remainder ("already written off") - the balance would be unreachable
  // by every door at once. A partial write-off keeps the status it had (`sent` or
  // `partially_paid`, both of which still read as owed) and moves only the
  // balance.
  const values: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'invoice_balance', value: remainingBalanceMinor },
  ]
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
