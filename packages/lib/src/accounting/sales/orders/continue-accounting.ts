// packages/lib/src/accounting/sales/orders/continue-accounting.ts

/**
 * Approval continues the chain (88 D10). A draft never depends on a draft, so
 * an order's events post one approval round at a time: once a receipt draft
 * posts, its shipment can draft; once the shipment posts, the next receipt or
 * the memo can; once the memo posts, the refund can. Re-running the order's
 * posters right after the approval makes the next event draft in the same
 * request instead of on the recovery job's next rotation.
 *
 * Reads and posts only what one order owns; the sweeps stay the org-wide net.
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { findLiveSubjectPostings } from '../../ledger/reads/list-postings'
import { postBlockedMovement } from '../../money/blocked-movements'
import { listOrderApplications, listRefundSettlements } from '../../money/reads'
import { type ChannelMemoPassCounts, sweepChannelCreditMemos } from '../credit-memos/issue-pass'
import { postFulfillmentAccounting } from '../fulfillments/accounting'
import { isLiveFulfillment } from '../fulfillments/client'
import { readFulfillmentsForOrder } from '../fulfillments/reads'

const logger = createScopedLogger('order-accounting-chain')

type PosterCounts = { accepted: number; drafted: number; blocked: number; skipped: number }

export interface ContinueOrderAccountingResult {
  /** Shipments offered to the poster, and how each answered. */
  shipments: PosterCounts
  /** Receipts and refunds offered to their posters, and how each answered. */
  movements: PosterCounts
  /** The order's draft channel memos the pass tried. */
  memos: ChannelMemoPassCounts
}

/** The order a posting's `parent` link names, or `null` for one that has none. */
export async function readPostingParentOrderId(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<string | null> {
  const [row] = await db
    .select({ sourceId: schema.GlPostingSource.sourceId })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.glPostingId, glPostingId),
        eq(schema.GlPostingSource.sourceKind, 'order'),
        eq(schema.GlPostingSource.linkRole, 'parent')
      )
    )
    .limit(1)
  return row?.sourceId ?? null
}

/**
 * Offer every unposted event of one order to its poster, in the order the
 * timeline wants them: shipments oldest first, then the receipts applied to
 * the order and the refunds that settle them.
 *
 * Never throws for a refusal - each poster answers with a status - but a read
 * that fails does throw; the caller decides whether that is fatal.
 */
export async function continueOrderAccounting(
  db: Database,
  input: { organizationId: string; orderId: string; actorUserId?: string }
): Promise<ContinueOrderAccountingResult> {
  const { organizationId, orderId, actorUserId } = input
  const shipments: PosterCounts = { accepted: 0, drafted: 0, blocked: 0, skipped: 0 }
  const movements: PosterCounts = { accepted: 0, drafted: 0, blocked: 0, skipped: 0 }

  const fulfillments = (await readFulfillmentsForOrder(db, { organizationId, orderId }))
    .filter(isLiveFulfillment)
    .filter((row) => row.glPosting === null)
    .sort((a, b) => a.shippedAt.localeCompare(b.shippedAt) || a.sequence - b.sequence)
  for (const fulfillment of fulfillments) {
    const result = await postFulfillmentAccounting(db, {
      organizationId,
      fulfillmentId: fulfillment.id,
      actorUserId,
    })
    shipments[result.status]++
  }

  const applications = await listOrderApplications(db, organizationId, orderId)
  const receiptIds = [...new Set(applications.map((row) => row.moneyTransactionId))]
  const refunds = receiptIds.length
    ? await listRefundSettlements(db, organizationId, { originalTransactionIds: receiptIds })
    : []
  const movementIds = [
    ...new Set([...receiptIds, ...refunds.map((row) => row.refundTransactionId)]),
  ]
  const offerMovements = async (ids: string[]) => {
    const posted = ids.length
      ? await findLiveSubjectPostings(db, organizationId, {
          sourceKind: 'money_transaction',
          sourceIds: ids,
        })
      : new Map<string, unknown>()
    for (const moneyTransactionId of ids) {
      if (posted.has(moneyTransactionId)) continue
      try {
        const result = await postBlockedMovement(db, {
          organizationId,
          moneyTransactionId,
          actorUserId,
        })
        movements[result.status]++
      } catch (error) {
        // A movement that names no document is nobody's to post; the next one still is.
        logger.warn('A movement on the order could not be offered to its poster', {
          organizationId,
          orderId,
          moneyTransactionId,
          error: error instanceof Error ? error.message : String(error),
        })
        movements.blocked++
      }
    }
  }
  await offerMovements(movementIds)

  // The memo waits on the receipts and shipments above (D2); the refund waits
  // on the memo, so a memo that issued here is offered its refunds at once.
  const memos = await sweepChannelCreditMemos(db, { organizationId, orderInstanceId: orderId })
  if (memos.issued > 0) await offerMovements(refunds.map((row) => row.refundTransactionId))

  return { shipments, movements, memos }
}

/**
 * The hook the draft-approval mutation calls once a draft posts: find the
 * order it parents and continue that order's chain. A draft with no parent
 * order (a journal entry, a vendor bill) has no chain to continue.
 *
 * Never throws - the approval has already committed, and a failed continuation
 * is the recovery job's to retry on its next pass.
 */
export async function continueAccountingAfterDraft(
  db: Database,
  input: { organizationId: string; glPostingId: string; actorUserId?: string }
): Promise<ContinueOrderAccountingResult | null> {
  const { organizationId, glPostingId, actorUserId } = input
  try {
    const orderId = await readPostingParentOrderId(db, organizationId, glPostingId)
    if (!orderId) return null
    return await continueOrderAccounting(db, { organizationId, orderId, actorUserId })
  } catch (error) {
    logger.warn('Continuing an order chain after approval failed; the sweep will retry', {
      organizationId,
      glPostingId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
