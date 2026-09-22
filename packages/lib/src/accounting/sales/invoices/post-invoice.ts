// packages/lib/src/accounting/sales/invoices/post-invoice.ts
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
// console's banner through `listFailedExports` on its own.
//
// {@link reverseInvoiceIssuance} is the opposite: a refused reversal must
// REFUSE THE VOID, because a voided invoice whose revenue stayed in the books
// is the same error this whole file exists to close, with the sign flipped. So
// it returns the refusal and `voidInvoice` throws on it, before the status is
// touched.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
//
// plans/accounting/tasks/done/08-invoice-revenue.md

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { DocumentPosting } from '../../documents/document-ledger-state'
import { INVOICE_SOURCE_TYPE } from '../../ledger/builders/invoice'
import { didLedgerAccept, isExpectedPostOutcome } from '../../ledger/post/ledger-accepted'
import { listPostingsForSource } from '../../ledger/reads/list-postings'
import { NON_FAILURE_REFUSALS, type PostResult } from '../../ledger/types'
import { postInvoiceIssuanceEntry, reverseInvoiceIssuanceEntry } from './issuance-accounting'

const logger = createScopedLogger('money-invoice-ledger')

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
 * Idempotent twice over. The period key is still the invoice's own number, so a
 * second call claims the same `(org, invoice_issued, periodKey, revision=0)`
 * tuple - and unlike a payment's minted key it cannot collide with a DIFFERENT
 * document, because an invoice number is unique in the org by construction. On
 * top of that the issuance now carries a durable `AccountingWork` whose
 * `effectKey` is unique per invoice, so a re-run converges on the ACCEPTED
 * EFFECT rather than on the claim alone (D19, 53 §7.3.3).
 *
 * 🔑 The accounting lives in `issuance-accounting.ts`; this function is the
 * never-throws door the invoice lifecycle calls through, and stays that.
 */
export async function postInvoiceIssuance(
  db: Database,
  input: PostInvoiceIssuanceInput
): Promise<PostResult> {
  const { organizationId, invoiceId, actorUserId } = input

  const post = await postInvoiceIssuanceEntry(db, {
    organizationId,
    invoiceId,
    actorUserId,
  })

  if (
    !isExpectedPostOutcome(post) &&
    // 🛑 `nothing_to_close` is not a failure and must not warn. An invoice with
    // no readable totals is an empty document, and a channel that fires on
    // routine outcomes is a channel nobody reads (`types.ts` NON_FAILURE_REFUSALS).
    !(NON_FAILURE_REFUSALS as readonly string[]).includes(post.status)
  ) {
    // 🛑 Recorded, never swallowed. A refusal AFTER the claim writes a
    // `pending`/`failed` `GlPosting` row, which `listFailedExports` reads,
    // so it surfaces on the close console on its own. A refusal BEFORE the
    // claim (a locked period, an unmapped `revenue_service` role) writes no
    // row at all, and this log line is the only trace - which is why it names
    // the status and the reason rather than "failed".
    logger.warn('An invoice issuance was not posted to the ledger', {
      organizationId,
      invoiceId,
      status: post.status,
      docNumber: post.docNumber,
      claimed: Boolean(post.glPostingId),
      error: post.error,
    })
  }

  return post
}

/**
 * Every general-ledger entry sourced on one invoice, newest first.
 *
 * `sourceType: 'invoice'` covers the issuance entry AND the write-off entry,
 * which is what a void has to reckon with and what the delete guard reads. A
 * draft waiting in the outbox is in the list with `status: 'draft'` through its
 * `pending` link.
 */
export async function listInvoicePostings(
  db: Database,
  params: { organizationId: string; invoiceId: string }
): Promise<DocumentPosting[]> {
  const result = await listPostingsForSource(db, {
    organizationId: params.organizationId,
    sourceKind: INVOICE_SOURCE_TYPE,
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
 * `reversed` has already been backed out, `failed` never reached the books and
 * a `draft` is not in them yet, so none is a reason to refuse anything. Read by
 * `field-hooks/pre/invoice-delete-guard.ts`.
 */
export async function hasLiveInvoicePostings(
  db: Database,
  params: { organizationId: string; invoiceId: string }
): Promise<{ live: boolean; docNumbers: string[] }> {
  const postings = await listInvoicePostings(db, params)
  const live = postings.filter(
    (posting) =>
      posting.status !== 'reversed' && posting.status !== 'failed' && posting.status !== 'draft'
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
 * `voidInvoice` refuses outright while any money is still applied, so no
 * application is left naming a voided invoice.
 */
export async function reverseInvoiceIssuance(
  db: Database,
  input: ReverseInvoiceIssuanceInput
): Promise<PostResult | null> {
  const { organizationId, invoiceId, actorUserId, memo } = input

  const result = await reverseInvoiceIssuanceEntry(db, {
    organizationId,
    invoiceId,
    actorUserId,
    memo: memo ?? undefined,
  })
  if (!result) return null
  if (!didLedgerAccept(result)) {
    logger.warn('An invoice issuance entry could not be reversed', {
      organizationId,
      invoiceId,
      status: result.status,
      error: result.error,
    })
    return result
  }
  logger.info('Reversed the issuance entry of an invoice being voided', {
    organizationId,
    invoiceId,
  })
  return null
}
