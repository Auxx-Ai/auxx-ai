// packages/lib/src/accounting/sales/invoices/issuance-accounting.ts

/**
 * The invoice issuance entry: `Dr accounts_receivable Cr revenue Cr sales_tax_payable`
 * at send, subject the invoice, counterparty its contact (TARGET §5).
 *
 * Save-after-Edit (brief 66) is {@link reverseInvoiceIssuanceEntry} then
 * {@link postInvoiceIssuanceEntry} - two calls on the two primitives, never an
 * amendment of a posted entry.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, UnprocessableEntityError } from '../../../errors'
import { documentEntryKey } from '../../documents/document-entry-key'
import {
  type BuiltInvoiceEntry,
  buildInvoiceEntry,
  INVOICE_SOURCE_TYPE,
} from '../../ledger/builders/invoice'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { GlPostingSourceInput, PostResult } from '../../ledger/types'
import { type InvoiceForIssuance, loadInvoiceForIssuance } from './issuance-reads'

const logger = createScopedLogger('money-invoice-issuance-accounting')

export interface InvoiceIssuanceEntrySource {
  /** The `invoice` EntityInstance id. The entry's subject and its claim. */
  invoiceId: string
  invoice: InvoiceForIssuance
  /** `YYYY-MM-DD`. The accounting date the entry is dated, resolved by the door. */
  issuedAt: string
  /** How many times this invoice has posted. 1 (the default) keys on the invoice number. */
  generation?: number
}

/**
 * The entry this invoice's CURRENT values produce - pure, persists nothing.
 *
 * The one place the record shape meets the builder, so the send path and the
 * edit lane's compare-and-repost cannot disagree about what an invoice's entry is.
 */
export function buildEntryForInvoiceIssuance(
  source: InvoiceIssuanceEntrySource
): BuiltInvoiceEntry {
  const { invoiceId, invoice, issuedAt } = source
  return buildInvoiceEntry({
    invoiceId,
    invoiceNumber: invoice.number,
    periodKey: documentEntryKey(invoice.number, source.generation ?? 1),
    issuedAt,
    subtotalMinor: invoice.subtotalMinor,
    taxTotalMinor: invoice.taxTotalMinor,
    totalMinor: invoice.totalMinor,
    contactInstanceId: invoice.contactInstanceId,
  })
}

export interface PostInvoiceIssuanceBuiltEntryInput {
  organizationId: string
  invoiceId: string
  /** `invoice_contact`, for the receivable line's counterparty. */
  contactInstanceId?: string | null
  entry: BuiltInvoiceEntry
  actorUserId?: string
  memo: string
}

/**
 * Put the built issuance entry in the books.
 *
 * **Never throws.** Every outcome is a `PostResult`; `null` means accounting is
 * off, which is a first-class case and not a degraded one.
 */
export async function postInvoiceIssuanceBuiltEntry(
  db: Database,
  input: PostInvoiceIssuanceBuiltEntryInput
): Promise<PostResult | null> {
  const { organizationId, invoiceId, contactInstanceId, entry, actorUserId, memo } = input
  if (!(await isAccountingEnabled(db, organizationId))) return null

  const sources: GlPostingSourceInput[] = [
    { sourceKind: INVOICE_SOURCE_TYPE, sourceId: invoiceId, linkRole: 'subject' },
    ...(contactInstanceId
      ? [{ sourceKind: 'contact', sourceId: contactInstanceId, linkRole: 'counterparty' as const }]
      : []),
  ]
  const lock = await resolvePeriodLock(organizationId)
  return postEntry(db, {
    organizationId,
    entry: entry.entry,
    actorUserId,
    lock,
    memo,
    sources,
  })
}

export interface PostInvoiceIssuanceEntryInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  actorUserId?: string
  /** Override the invoice's own `issuedAt`. Absent uses the stamped date, else today. */
  issuedAt?: string
  /** How many times this invoice has posted. Absent keys on the invoice number. */
  generation?: number
}

/**
 * Post one invoice's issuance entry.
 *
 * **Never throws.** Every refusal is a {@link PostResult}: an invoice must not
 * fail to SEND because its bookkeeping did.
 */
export async function postInvoiceIssuanceEntry(
  db: Database,
  input: PostInvoiceIssuanceEntryInput
): Promise<PostResult> {
  const { organizationId, invoiceId, actorUserId } = input
  if (!(await isAccountingEnabled(db, organizationId))) return { status: 'not_enabled' }

  try {
    const invoice = await loadInvoiceForIssuance(db, organizationId, invoiceId)
    if (!invoice)
      return {
        status: 'nothing_to_close',
        error: `Invoice ${invoiceId} has no readable totals, so there is nothing to recognise.`,
      }

    const issuedAt =
      input.issuedAt ?? invoice.issuedAt ?? (await todayInBookTimeZone(organizationId))
    const built = buildEntryForInvoiceIssuance({
      invoiceId,
      invoice,
      issuedAt,
      generation: input.generation,
    })

    const posted = await postInvoiceIssuanceBuiltEntry(db, {
      organizationId,
      invoiceId,
      contactInstanceId: invoice.contactInstanceId,
      entry: built,
      actorUserId,
      memo: `Invoice ${invoice.number || invoiceId} issued`,
    })
    return posted ?? { status: 'not_enabled' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('An invoice issuance was not posted to the ledger', {
      organizationId,
      invoiceId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }
}

export interface ReverseInvoiceIssuanceEntryInput {
  organizationId: string
  invoiceId: string
  actorUserId?: string
  memo?: string
}

/**
 * Reverse the invoice's live issuance posting, freeing the claim so the invoice
 * can post again. `null` when nothing is standing.
 */
export async function reverseInvoiceIssuanceEntry(
  db: Database,
  input: ReverseInvoiceIssuanceEntryInput
): Promise<PostResult | null> {
  const { organizationId, invoiceId, actorUserId, memo } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: INVOICE_SOURCE_TYPE,
    sourceId: invoiceId,
    occurrence: 'original',
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: memo ?? `Reversal of ${live.value.docNumber} - invoice issuance backed out`,
  })
}
