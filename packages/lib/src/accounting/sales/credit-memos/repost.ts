// packages/lib/src/accounting/sales/credit-memos/repost.ts

/**
 * The one correction coupling 91 §4.8 keeps: a memo already posted, then its order's
 * fulfillment cancelled. The memo's lines re-read their shipped qty; when the rebuilt entry
 * differs from the live one it is reversed and re-posted at the next generation, so the
 * shipment reversal and the memo net. No permission checks here.
 */

import { type Database, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { readEditStamp } from '../../../entity-instances/edit-snapshot'
import { UnprocessableEntityError } from '../../../errors'
import { documentEntryKey } from '../../documents/document-entry-key'
import {
  readDocumentLedgerState,
  writeDocumentLedgerGeneration,
} from '../../documents/document-ledger-state'
import { entryLinesEqual, readBuiltEntry } from '../../documents/edit-in-place/save'
import { CREDIT_MEMO_SOURCE_TYPE } from '../../ledger/builders/credit-memo'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { readFulfillmentPostingSubject } from '../fulfillments/reads'
import { buildEntryForCreditMemo, organizationCurrency, postCreditMemoEntry } from './accounting'
import {
  listCreditMemoIdsForOrder,
  loadCreditMemo,
  loadCreditMemoLines,
  readShippedMemoLineIds,
} from './reads'

const logger = createScopedLogger('sales:credit-memo-repost')

export type CreditMemoRepostOutcome = 'unchanged' | 'reposted' | 'reversed'

/**
 * Re-post one memo from its lines' shipped state as it stands now. `null` when there is
 * nothing to correct: no live entry, a memo open for editing (Save rebuilds it), or a rebuild
 * equal to what stands. Throws an `AuxxError` when the ledger refuses; nothing is written then.
 */
export async function repostCreditMemoEntry(
  db: Database,
  input: { organizationId: string; creditMemoInstanceId: string; actorUserId?: string }
): Promise<CreditMemoRepostOutcome | null> {
  const { organizationId, creditMemoInstanceId, actorUserId } = input
  const memo = await loadCreditMemo(db, organizationId, creditMemoInstanceId)
  if (!memo?.issuedAt || memo.status === 'draft' || memo.status === 'void') return null
  if (await readEditStamp(db, organizationId, memo.id)) return null

  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: memo.id,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lines = await loadCreditMemoLines(db, organizationId, memo.lineIds)
  const shippedLineIds = await readShippedMemoLineIds(
    db,
    organizationId,
    memo,
    lines,
    memo.issuedAt
  )
  const state = await readDocumentLedgerState(db, organizationId, memo.id)
  const generation = state.generation + 1
  const rebuilt = buildEntryForCreditMemo({
    memo,
    lines,
    issuedAt: memo.issuedAt,
    currency: await organizationCurrency(organizationId),
    shippedLineIds,
    generation,
  })
  const liveEntry = await readBuiltEntry(db, organizationId, live.value.id)
  if (rebuilt && entryLinesEqual(rebuilt.entry, liveEntry)) return 'unchanged'

  const lock = await resolvePeriodLock(organizationId)
  const docNumber = live.value.docNumber
  // One transaction under the commit lock, so the reversal and the repost land together.
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    const txDb = tx as unknown as Database
    const reversal = await reverseEntry(txDb, {
      organizationId,
      glPostingId: live.value!.id,
      actorUserId,
      lock,
      memo: `Reversal of ${docNumber} - credit memo ${memo.number}, its shipment cancelled`,
    })
    if (!didLedgerAccept(reversal))
      throw new UnprocessableEntityError(
        `Credit memo ${memo.number}'s entry could not be reversed: ${reversal.error ?? reversal.status}`
      )
    if (rebuilt) {
      const post = await postCreditMemoEntry(txDb, {
        organizationId,
        creditMemoInstanceId: memo.id,
        contactInstanceId: memo.contactInstanceId,
        orderInstanceId: memo.orderInstanceId,
        entry: rebuilt.entry,
        actorUserId,
        memo: `Credit memo ${memo.number} re-posted after its shipment was cancelled`,
      })
      if (!didLedgerAccept(post))
        throw new UnprocessableEntityError(
          `Credit memo ${memo.number} could not be re-posted: ${post.error ?? post.status}`
        )
    }
    await writeDocumentLedgerGeneration(txDb, organizationId, memo.id, generation)
  })
  logger.info('Credit memo re-posted after a shipment cancel', {
    organizationId,
    creditMemoInstanceId: memo.id,
    docNumber,
    periodKey: documentEntryKey(memo.number, generation),
    outcome: rebuilt ? 'reposted' : 'reversed',
  })
  return rebuilt ? 'reposted' : 'reversed'
}

/**
 * Re-post every memo on a cancelled fulfillment's order. Never throws: one memo the ledger
 * refuses is logged and the rest still run.
 */
export async function repostCreditMemosForCancelledFulfillment(
  db: Database,
  input: { organizationId: string; fulfillmentInstanceId: string; actorUserId?: string }
): Promise<void> {
  const { organizationId, fulfillmentInstanceId, actorUserId } = input
  const subject = await readFulfillmentPostingSubject(db, {
    organizationId,
    fulfillmentId: fulfillmentInstanceId,
  })
  if (!subject) return
  for (const creditMemoInstanceId of await listCreditMemoIdsForOrder(
    db,
    organizationId,
    subject.orderId
  )) {
    try {
      await repostCreditMemoEntry(db, { organizationId, creditMemoInstanceId, actorUserId })
    } catch (error) {
      logger.error('Credit memo re-post after a shipment cancel failed', {
        organizationId,
        creditMemoInstanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
