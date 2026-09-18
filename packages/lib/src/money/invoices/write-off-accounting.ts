// packages/lib/src/money/invoices/write-off-accounting.ts

/**
 * The invoice write-off entry: `Dr bad_debt_expense Cr accounts_receivable`,
 * subject the invoice with the ATTEMPT as its occurrence (TARGET §5).
 *
 * 🛑 The occurrence is `write_off:<attempt>` and never `'original'`: the
 * issuance entry already claims `(invoice, <id>, 'original')`, and a write-off
 * is a repeatable action against the same source.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  buildWriteOffEntry,
  WRITE_OFF_SOURCE_TYPE,
} from '../../accounting/ledger/builders/write-off'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { readAutoPostMode } from '../../accounting/ledger/post/auto-post'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { reverseEntry } from '../../accounting/ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../accounting/ledger/reads/list-postings'
import { isAccountingEnabled } from '../../accounting/ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../accounting/ledger/setup/book-time-zone'
import type { GlPostingSourceInput, PostResult } from '../../accounting/ledger/types'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { countWriteOffPostings, loadInvoiceForWriteOff } from './write-off-reads'

const logger = createScopedLogger('money-invoice-write-off-accounting')

/** The claim occurrence for one write-off attempt against an invoice. */
export function writeOffOccurrence(attempt: number): string {
  return `write_off:${attempt}`
}

export interface AcceptInvoiceWriteOffInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  /** Integer minor units, > 0. Decided by the caller, never re-derived here. */
  amountMinor: number
  /** The write-off's reason, which is also the journal and line memo. */
  reason: string
  actorUserId?: string
  /**
   * A `gl_account` id out of the org's own chart, overriding the debit leg.
   * Omit to use the `bad_debt_expense` role (the ordinary case).
   */
  expenseGlAccountId?: string
}

/**
 * Post one write-off.
 *
 * **Never throws.** Every refusal is a {@link PostResult}, so `writeOffInvoice`
 * can still reduce the invoice's balance when the books refuse the entry.
 */
export async function acceptInvoiceWriteOffAccounting(
  db: Database,
  input: AcceptInvoiceWriteOffInput
): Promise<PostResult> {
  const { organizationId, invoiceId, amountMinor, reason, actorUserId, expenseGlAccountId } = input
  if (!(await isAccountingEnabled(db, organizationId))) return { status: 'not_enabled' }

  try {
    const invoice = await loadInvoiceForWriteOff(db, organizationId, invoiceId)
    if (!invoice)
      return {
        status: 'nothing_to_close',
        error: `Invoice ${invoiceId} can no longer be read, so there is nothing to write off.`,
      }

    const txnDate = await todayInBookTimeZone(organizationId)
    const attempt = await countWriteOffPostings(db, organizationId, invoiceId)
    const entry = buildWriteOffEntry({
      invoiceId,
      invoiceNumber: invoice.number,
      attempt,
      amountMinor,
      txnDate,
      expenseGlAccountId,
      memo: reason,
      contactInstanceId: invoice.contactInstanceId,
    })

    const sources: GlPostingSourceInput[] = [
      {
        sourceKind: WRITE_OFF_SOURCE_TYPE,
        sourceId: invoiceId,
        linkRole: 'subject',
        occurrence: writeOffOccurrence(attempt),
      },
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
      entry,
      actorUserId,
      lock,
      memo: reason,
      sources,
      mode: await readAutoPostMode(organizationId, 'invoice'),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('An invoice write-off was not posted to the ledger', {
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

/**
 * Reverse one write-off attempt's live posting, freeing its claim. `null` when
 * that attempt has nothing standing.
 */
export async function reverseInvoiceWriteOffAccounting(
  db: Database,
  input: { organizationId: string; invoiceId: string; attempt: number; actorUserId?: string }
): Promise<PostResult | null> {
  const { organizationId, invoiceId, attempt, actorUserId } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: WRITE_OFF_SOURCE_TYPE,
    sourceId: invoiceId,
    occurrence: writeOffOccurrence(attempt),
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: `Reversal of ${live.value.docNumber} - write-off backed out`,
  })
}
