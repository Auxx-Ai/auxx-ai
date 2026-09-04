// packages/lib/src/money/payments/post-transaction.ts

/**
 * Posting a `PaymentTransaction` to the general ledger.
 *
 * The write half of `postings/build-payment-entry.ts`, kept out of `ledger.ts`
 * so that file stays what it is - the payment ledger's own writer - and so the
 * reads and the posting do not share a file (`docs/lib-module-guide.md` §5).
 *
 * ## 🛑 It posts from the TRANSACTION TABLE, never from the `payment` entity
 *
 * `syncTransaction` mints a `payment` entity mirror per allocation, and only for
 * a `succeeded` `charge`. **Refund rows get no mirror at all** (`ledger.ts`:
 * "Refund transactions never get mirrors"), so anything that posted from the
 * entity would silently miss every refund and leave A/R overstated by the whole
 * refunded amount, forever, with a balanced ledger.
 *
 * ## ⚠️ This cannot post yet, and says so rather than pretending
 *
 * `POSTING_TYPES` has no `payment` member. The union has exactly two copies -
 * `postings/types.ts` and the `GlPostingType` pgEnum - which move in ONE change,
 * and both are coordinator-held (HANDOFF §4). So {@link PAYMENT_POSTING_TYPE}
 * is a cast with a TODO, `postEntry` will be refused by the enum, and the
 * refusal comes back as a `PostResult` with `status: 'error'` rather than as a
 * throw. That is the honest shape: the path is wired, tested and driveable, and
 * the day the type lands it starts working with no other change.
 *
 * Nothing here throws. Every outcome is a `PostResult`, so `syncTransaction`
 * can call it without a try/catch of its own and a failed post can never fail
 * the payment that produced it.
 */

import { type Database, type PaymentTransactionEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import {
  buildPaymentEntry,
  PAYMENT_SOURCE_TYPE,
  paymentPeriodKey,
} from '../../postings/build-payment-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY, postEntry } from '../../postings/post-entry'
import { readPostingLineSourceIds } from '../../postings/read-posting'
import type { PostingType, PostResult } from '../../postings/types'
import { resolvePaymentRoute } from '../bank-deposits/client'

const logger = createScopedLogger('money-payments-ledger')

/**
 * The posting type a payment entry claims. In both union copies since drizzle
 * 0362, prefix `PMT` (`PAY` is the payout's). `regime.ts` declares it as
 * driving no single-writer role: cash is written only on the `cash` route,
 * which never overlaps `bank_deposit`'s money, and the guard is per type, not
 * per route.
 */
export const PAYMENT_POSTING_TYPE: PostingType = 'payment'

/** The statuses that mean the ledger took the payment. */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

/**
 * The transaction statuses that move money and therefore reach the ledger.
 *
 * `disputed` is in on purpose and mirrors `computeAmountPaid`: a dispute flags a
 * row for attention but does not reduce what was received until it resolves into
 * an actual refund, which arrives as its own transaction with its own entry.
 * `pending`, `processing`, `failed` and `canceled` moved nothing and must post
 * nothing - an entry for a charge that never succeeded overstates both cash and
 * revenue-collected with a perfectly balanced posting.
 */
const POSTABLE_STATUSES = new Set(['succeeded', 'disputed'])

/**
 * Post one `PaymentTransaction` to the ledger, or explain why it was not.
 *
 * **Never throws.** Every refusal is a {@link PostResult} status:
 *
 * - `nothing_to_close` - the row is not in a state that moves money.
 * - `error` - the entry could not be built (a foreign currency, an amount that
 *   is not whole cents) or the ledger refused it.
 * - everything `postEntry` itself can answer, unchanged.
 *
 * Idempotent by the claim's unique index: the period key is a deterministic
 * function of the transaction id, so a second call converges to
 * `already_posted` rather than posting twice.
 */
export async function postPaymentTransaction(
  db: Database,
  params: { organizationId: string; transaction: PaymentTransactionEntity; actorUserId?: string }
): Promise<PostResult> {
  const { organizationId, transaction, actorUserId } = params

  if (!POSTABLE_STATUSES.has(transaction.status)) {
    return {
      status: 'nothing_to_close',
      error: `Payment ${transaction.id} is ${transaction.status}, which moved no money.`,
    }
  }

  try {
    const settings = await getOrgCache().get(organizationId, 'orgSettings')
    const route = resolvePaymentRoute(transaction.method, settings)

    // The user-picked (possibly backdated) date rides in `metadata.date`; the
    // row's own `createdAt` is when it was KEYED, which is not the accounting
    // date. `recordManualPayment` is the writer of that metadata.
    const metadataDate = (transaction.metadata as { date?: string } | null)?.date
    const receivedAt =
      metadataDate && /^\d{4}-\d{2}-\d{2}$/.test(metadataDate)
        ? metadataDate
        : transaction.createdAt.toISOString().slice(0, 10)

    const built = buildPaymentEntry({
      postingType: PAYMENT_POSTING_TYPE,
      transaction: {
        id: transaction.id,
        kind: transaction.kind === 'refund' ? 'refund' : 'charge',
        amountMinor: transaction.amount,
        method: transaction.method,
        currency: transaction.currency,
        receivedAt,
        reference: transaction.reference,
      },
      route,
      periodKey: paymentPeriodKey(transaction.id),
      ledgerCurrency: LEDGER_CURRENCY,
    })

    const lock = await resolvePeriodLock(organizationId)
    const post = await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId,
      lock,
      memo: `${transaction.kind === 'refund' ? 'Refund' : 'Payment'} ${transaction.id}`,
    })

    // 🛑 `already_posted` is a SUCCESS status, and for a payment it is only a
    // success when the posting that already holds the key is THIS transaction's.
    // `paymentPeriodKey` mints the key by hashing a cuid into six base-36
    // digits, so two different transactions can land on one key; the loser then
    // gets `already_posted`, `syncTransaction` records a clean outcome, and that
    // payment's cash silently never reaches the books. The winning posting's
    // line `sourceId` is what tells the two apart - a converged re-post of the
    // same row names this transaction, a collision names another one.
    if (post.status === 'already_posted' && post.glPostingId) {
      const read = await readPostingLineSourceIds(db, organizationId, {
        glPostingId: post.glPostingId,
        sourceType: PAYMENT_SOURCE_TYPE,
      })
      // A read that FAILED leaves the status alone. Turning an unreadable
      // posting into an error would refuse an ordinary converged re-post on a
      // transient database fault, which is the opposite of the trade this check
      // is making; a posting with no payment lines at all is likewise not
      // evidence of a collision.
      const owners = read.isOk() ? read.value : []
      if (owners.length > 0 && !owners.includes(transaction.id)) {
        const heldBy = owners.join(', ')
        logger.error('A payment period key collided with another transaction', {
          organizationId,
          transactionId: transaction.id,
          glPostingId: post.glPostingId,
          docNumber: post.docNumber,
          heldBy,
        })
        return {
          status: 'error',
          failureClass: 'data',
          retryable: false,
          error:
            `Payment ${transaction.id} minted the document number ${post.docNumber ?? '(unknown)'}, ` +
            `which is already held by a different payment (${heldBy}). This is a period-key hash ` +
            'collision, not a re-post: no entry was written for this payment, and it has to be ' +
            'posted by hand as a journal entry.',
        }
      }
    }

    if (!ACCEPTED_POST_STATUSES.has(post.status)) {
      // 🛑 Recorded, never swallowed. `postEntry` writes a `pending`/`failed`
      // `GlPosting` row once the claim succeeded, which is what
      // `listUnpostedPeriods` reads - so a refusal AFTER the claim surfaces on
      // the close console's banner on its own. A refusal BEFORE the claim
      // (a locked period, an unmapped role, a posting type the enum does not
      // hold) writes no row at all, and this log line is the only trace, which
      // is why it names the status and the reason rather than "failed".
      logger.warn('Payment was not posted to the ledger', {
        organizationId,
        transactionId: transaction.id,
        kind: transaction.kind,
        route,
        status: post.status,
        docNumber: post.docNumber,
        claimed: Boolean(post.glPostingId),
        error: post.error,
      })
    }

    return post
  } catch (error) {
    // A builder refusal - a foreign currency, an amount that is not whole cents.
    // Returned rather than rethrown so a payment can never fail because its
    // bookkeeping did.
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Could not build a payment entry', {
      organizationId,
      transactionId: transaction.id,
      error: message,
    })
    return { status: 'error', failureClass: 'data', retryable: false, error: message }
  }
}

/**
 * Every `GlPosting` this transaction produced, newest first.
 *
 * Reads by the line's `sourceType`/`sourceId` pair rather than by period key,
 * because that pair is what makes a posting explainable later without joining
 * through a provider - and it is what the `ledger` record card on the payment
 * drawer will read.
 */
export async function listPaymentPostings(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<Array<{ glPostingId: string; docNumber: string; status: string }>> {
  const rows = await db
    .selectDistinct({
      glPostingId: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
      status: schema.GlPosting.status,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, params.organizationId),
        eq(schema.GlPostingLine.sourceType, PAYMENT_SOURCE_TYPE),
        eq(schema.GlPostingLine.sourceId, params.transactionId)
      )
    )
  return rows
}
