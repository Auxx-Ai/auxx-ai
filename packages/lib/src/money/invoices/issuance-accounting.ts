// packages/lib/src/money/invoices/issuance-accounting.ts

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
import { buildInvoiceEntry, INVOICE_SOURCE_TYPE } from '../../accounting/ledger/builders/invoice'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { readAutoPostMode } from '../../accounting/ledger/post/auto-post'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { reverseEntry } from '../../accounting/ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../accounting/ledger/reads/list-postings'
import { isAccountingEnabled } from '../../accounting/ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../accounting/ledger/setup/book-time-zone'
import type { GlPostingSourceInput, PostResult } from '../../accounting/ledger/types'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { loadInvoiceForIssuance } from './issuance-reads'

const logger = createScopedLogger('money-invoice-issuance-accounting')

export interface PostInvoiceIssuanceEntryInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  actorUserId?: string
  /** Override the invoice's own `issuedAt`. Absent uses the stamped date, else today. */
  issuedAt?: string
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
    const built = buildInvoiceEntry({
      invoiceId,
      invoiceNumber: invoice.number,
      issuedAt,
      subtotalMinor: invoice.subtotalMinor,
      taxTotalMinor: invoice.taxTotalMinor,
      totalMinor: invoice.totalMinor,
      contactInstanceId: invoice.contactInstanceId,
    })

    const sources: GlPostingSourceInput[] = [
      { sourceKind: INVOICE_SOURCE_TYPE, sourceId: invoiceId, linkRole: 'subject' },
      ...(invoice.contactInstanceId
        ? [
            {
              sourceKind: 'contact',
              sourceId: invoice.contactInstanceId,
              linkRole: 'counterparty' as const,
            },
          ]
        : []),
    ]
    const lock = await resolvePeriodLock(organizationId)
    return await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId,
      lock,
      memo: `Invoice ${invoice.number || invoiceId} issued`,
      sources,
      mode: await readAutoPostMode(organizationId, 'invoice'),
    })
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
