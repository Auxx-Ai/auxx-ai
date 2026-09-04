// packages/lib/src/money/invoices/post-invoice.ts
//
// Posting an invoice's ISSUANCE to the general ledger, and backing it out again
// when the invoice is voided.
//
// The write half of `postings/build-invoice-entry.ts`, kept beside
// `write-off.ts` rather than inside `invoice-lifecycle.ts` so the lifecycle file
// stays what it is - the invoice's status writer - and so the read, the build
// and the post do not share a file with it (`docs/lib-module-guide.md` §5).
//
// ## Never throws
//
// Every outcome of {@link postInvoiceIssuance} is a `PostResult`, logged with
// its status and whether the period was claimed, exactly as
// `postPaymentTransaction` does. An invoice must not fail to SEND because its
// bookkeeping did: the customer is waiting on the document, the refusal is
// recoverable, and a claimed-but-unposted period surfaces on the close
// console's banner through `listUnpostedPeriods` on its own.
//
// {@link reverseInvoiceIssuance} is the opposite: a refused reversal must
// REFUSE THE VOID, because a voided invoice whose revenue stayed in the books
// is the same error this whole file exists to close, with the sign flipped. So
// it returns the refusal and `voidInvoice` throws on it, before the status is
// touched.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
//
// plans/accounting/tasks/08-invoice-revenue.md

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import {
  buildInvoiceEntry,
  INVOICE_ISSUED_POSTING_TYPE,
  INVOICE_SOURCE_TYPE,
} from '../../postings/build-invoice-entry'
import { listPostingsForSource } from '../../postings/list-postings'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { postEntry } from '../../postings/post-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'

const logger = createScopedLogger('money-invoice-ledger')

/** The statuses that mean the ledger took the entry. */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

/**
 * The statuses that mean a reversal landed, or had nothing to do.
 *
 * The same set `reversePaymentPostings` uses, and for the same reason: a
 * provider that is not connected or is switched off still leaves OUR ledger
 * correct, which is the half a void has to protect.
 */
const ACCEPTED_REVERSAL_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

const INVOICE_ATTRIBUTES = [
  'invoice_number',
  'invoice_issued_at',
  'invoice_subtotal',
  'invoice_tax_total',
  'invoice_total',
] as const

/** The invoice values an issuance entry is built from. Nothing else is read. */
interface InvoiceForIssuance {
  number: string
  /** `YYYY-MM-DD`, or `null` when nothing has been stamped. */
  issuedAt: string | null
  subtotalMinor: number | null
  taxTotalMinor: number | null
  totalMinor: number | null
}

/**
 * Read the five values off `FieldValue` directly.
 *
 * A plain read rather than `UnifiedCrudHandler.getFieldValues`, which needs an
 * actor - the same trade `write-off.ts` makes so its preview and its writer can
 * share one loader.
 */
async function loadInvoiceForIssuance(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<InvoiceForIssuance | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...INVOICE_ATTRIBUTES])
  const fields = [
    cf.invoice_number,
    cf.invoice_issued_at,
    cf.invoice_subtotal,
    cf.invoice_tax_total,
    cf.invoice_total,
  ].filter((field) => field !== null)
  if (fields.length === 0) return null

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, invoiceId),
        inArray(
          schema.FieldValue.fieldId,
          fields.map((field) => field.id)
        )
      )
    )
  const byField = new Map(rows.map((row) => [row.fieldId, row]))

  const number = (cf.invoice_number ? byField.get(cf.invoice_number.id)?.valueText : null) ?? ''
  // `FieldValue.valueDate` arrives as an ISO instant; the accounting date is
  // the calendar day the bookkeeper wrote, so it is sliced, never re-zoned.
  const rawIssuedAt = cf.invoice_issued_at ? byField.get(cf.invoice_issued_at.id)?.valueDate : null
  const issuedAt =
    typeof rawIssuedAt === 'string' && rawIssuedAt.length >= 10 ? rawIssuedAt.slice(0, 10) : null

  return {
    number,
    issuedAt,
    subtotalMinor:
      (cf.invoice_subtotal ? byField.get(cf.invoice_subtotal.id)?.valueNumber : null) ?? null,
    taxTotalMinor:
      (cf.invoice_tax_total ? byField.get(cf.invoice_tax_total.id)?.valueNumber : null) ?? null,
    totalMinor: (cf.invoice_total ? byField.get(cf.invoice_total.id)?.valueNumber : null) ?? null,
  }
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

export interface PostInvoiceIssuanceInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  actorUserId?: string
}

/**
 * Post one invoice's issuance entry, or explain why it was not.
 *
 * ```
 *   Dr accounts_receivable   total
 *       Cr revenue_service     total - tax
 *       Cr sales_tax_payable   tax
 * ```
 *
 * **Never throws.** Every refusal is a {@link PostResult}.
 *
 * 🛑 **Call it AFTER the writes that send the invoice have committed**, never
 * inside the same step. The post resolves its source on a different connection
 * and cannot see uncommitted rows - the standing rule for post-commit work in
 * this codebase.
 *
 * Idempotent by the claim's unique index: the period key is the invoice's own
 * number, so a second call claims the same
 * `(org, invoice_issued, periodKey, revision=0)` tuple and converges to
 * `already_posted`. Unlike a payment's minted key this cannot collide with a
 * DIFFERENT document, because an invoice number is unique in the org by
 * construction, so no owner check is needed on top of it.
 */
export async function postInvoiceIssuance(
  db: Database,
  input: PostInvoiceIssuanceInput
): Promise<PostResult> {
  const { organizationId, invoiceId, actorUserId } = input

  try {
    const invoice = await loadInvoiceForIssuance(db, organizationId, invoiceId)
    if (!invoice) {
      return {
        status: 'nothing_to_close',
        error: `Invoice ${invoiceId} has no readable totals, so there is nothing to recognise.`,
      }
    }

    // `markInvoiceSent` stamps `issuedAt` when it is empty, so this fallback is
    // for an invoice sent by some other door. Today in the BOOK time zone, not
    // UTC: a period boundary is a wall-clock midnight (ground rule 5).
    const issuedAt = invoice.issuedAt ?? (await todayInBookTimeZone(organizationId))

    const built = buildInvoiceEntry({
      invoiceId,
      invoiceNumber: invoice.number,
      issuedAt,
      subtotalMinor: invoice.subtotalMinor,
      taxTotalMinor: invoice.taxTotalMinor,
      totalMinor: invoice.totalMinor,
    })

    const lock = await resolvePeriodLock(organizationId)
    const post = await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId,
      lock,
      memo: `Invoice ${invoice.number} issued`,
    })

    if (!ACCEPTED_POST_STATUSES.has(post.status)) {
      // 🛑 Recorded, never swallowed. A refusal AFTER the claim writes a
      // `pending`/`failed` `GlPosting` row, which `listUnpostedPeriods` reads,
      // so it surfaces on the close console on its own. A refusal BEFORE the
      // claim (a locked period, an unmapped `revenue_service` role) writes no
      // row at all, and this log line is the only trace - which is why it names
      // the status and the reason rather than "failed".
      logger.warn('An invoice issuance was not posted to the ledger', {
        organizationId,
        invoiceId,
        invoiceNumber: invoice.number,
        status: post.status,
        docNumber: post.docNumber,
        claimed: Boolean(post.glPostingId),
        error: post.error,
      })
    }

    return post
  } catch (error) {
    // A builder refusal - a blank or over-long invoice number, a total that is
    // not whole cents, an invoice that is all tax. Returned rather than
    // rethrown so an invoice can never fail to send because its bookkeeping did.
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Could not build an invoice issuance entry', {
      organizationId,
      invoiceId,
      error: message,
    })
    return { status: 'error', failureClass: 'data', retryable: false, error: message }
  }
}

/**
 * Every general-ledger entry sourced on one invoice, newest first.
 *
 * `sourceType: 'invoice'` covers the issuance entry AND the write-off entry,
 * which is what a void has to reckon with and what the delete guard reads.
 */
export async function listInvoicePostings(
  db: Database,
  params: { organizationId: string; invoiceId: string }
): Promise<Array<{ glPostingId: string; docNumber: string; status: string; postingType: string }>> {
  const result = await listPostingsForSource(db, {
    organizationId: params.organizationId,
    sourceType: INVOICE_SOURCE_TYPE,
    sourceId: params.invoiceId,
  })
  if (result.isErr()) return []
  return result.value.map((posting) => ({
    glPostingId: posting.id,
    docNumber: posting.docNumber,
    status: posting.status,
    postingType: posting.postingType,
  }))
}

/**
 * True when this invoice has a general-ledger entry that is still standing.
 *
 * `reversed` has already been backed out and `failed` never reached the books,
 * so neither is a reason to refuse anything. Read by
 * `field-hooks/pre/invoice-delete-guard.ts`.
 */
export async function hasLiveInvoicePostings(
  db: Database,
  params: { organizationId: string; invoiceId: string }
): Promise<{ live: boolean; docNumbers: string[] }> {
  const postings = await listInvoicePostings(db, params)
  const live = postings.filter(
    (posting) => posting.status !== 'reversed' && posting.status !== 'failed'
  )
  return { live: live.length > 0, docNumbers: live.map((posting) => posting.docNumber) }
}

export interface ReverseInvoiceIssuanceInput {
  organizationId: string
  invoiceId: string
  actorUserId?: string
  memo?: string
}

/**
 * Back an invoice's issuance entry out of the books.
 *
 * Returns `null` when the reversal landed (or there was nothing standing to
 * reverse), and a {@link PostResult} carrying the refusal otherwise. The caller
 * turns that into a refusal of the VOID - see the file header.
 *
 * ## What it does NOT have to handle, and why
 *
 * A deposit APPLIED to this invoice would leave a `deposit_application` entry
 * crediting a receivable that is about to disappear. That entry is sourced on
 * the payment transaction, not on the invoice, so it is invisible here - and it
 * does not need to be visible, because `voidInvoice` refuses outright while any
 * succeeded charge is allocated to the invoice (`hasSucceededCharges`). An
 * applied deposit IS such an allocation. So a void can never strand an
 * application entry: the deposit has to be un-applied first, and un-applying it
 * goes through `deleteManualPayment`, which reverses the reclass and the receipt
 * together in `reversePaymentPostings`.
 *
 * If that guard is ever relaxed, this is the function that has to grow the
 * second read.
 */
export async function reverseInvoiceIssuance(
  db: Database,
  input: ReverseInvoiceIssuanceInput
): Promise<PostResult | null> {
  const { organizationId, invoiceId, actorUserId, memo } = input

  const postings = await listInvoicePostings(db, { organizationId, invoiceId })
  const live = postings.filter(
    (posting) =>
      posting.postingType === INVOICE_ISSUED_POSTING_TYPE &&
      posting.status !== 'reversed' &&
      posting.status !== 'failed'
  )
  if (live.length === 0) return null

  const lock = await resolvePeriodLock(organizationId)
  for (const posting of live) {
    const result = await reverseEntry(db, {
      organizationId,
      glPostingId: posting.glPostingId,
      actorUserId,
      lock,
      memo: memo ?? `Reversal of ${posting.docNumber} - invoice voided`,
    })
    if (!ACCEPTED_REVERSAL_STATUSES.has(result.status)) {
      logger.warn('An invoice issuance entry could not be reversed', {
        organizationId,
        invoiceId,
        docNumber: posting.docNumber,
        status: result.status,
        error: result.error,
      })
      return result
    }
  }

  logger.info('Reversed the issuance entries of an invoice being voided', {
    organizationId,
    invoiceId,
    reversed: live.length,
  })
  return null
}
