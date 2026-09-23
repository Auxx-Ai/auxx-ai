// packages/lib/src/inventory/relief/relief-sweep.ts

import type { Database } from '@auxx/database'
import { readFulfillmentPostingSubject } from '../../accounting/sales/fulfillments'
import { runWorkItemSweep, type SweepCounts } from '../../accounting/work-items/sweep'
import { deleteWorkItemsAtStage } from '../../accounting/work-items/write'
import { getOrgCache } from '../../cache'
import { readReliefLines } from './backfill'
import { relieveFulfillmentLines } from './relieve'

/**
 * Re-offer the dispatches relief parked at stage `relieve` (plans/accounting/tasks/100 §1.3).
 * Nothing is fresh here: dispatch and sync drive new relief, the backfill is the bulk door.
 */
export async function sweepFulfillmentRelief(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SweepCounts> {
  const { organizationId } = input
  return runWorkItemSweep(db, {
    organizationId,
    stage: 'relieve',
    sourceKind: 'fulfillment',
    limit: input.limit ?? 100,
    timeBudgetMs: input.timeBudgetMs,
    listFresh: async () => [],
    handle: (fulfillmentId) => relieveOne(db, organizationId, fulfillmentId),
  })
}

async function relieveOne(
  db: Database,
  organizationId: string,
  fulfillmentId: string
): Promise<{ status: string }> {
  const subject = await readFulfillmentPostingSubject(db, { organizationId, fulfillmentId })
  const lines = subject
    ? (await readReliefLines(db, organizationId, [subject.orderId], fulfillmentId)).lines
    : []
  // Gone, orderless or cancelled: nothing left to relieve, so nothing left to park.
  if (lines.length === 0) {
    await deleteWorkItemsAtStage(db, organizationId, {
      sourceKind: 'fulfillment',
      sourceIds: [fulfillmentId],
      stage: 'relieve',
    })
    return { status: 'skipped' }
  }
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const result = await relieveFulfillmentLines(db, { organizationId, userId, lines })
  if (result.isErr()) throw result.error
  return { status: result.value.skippedNoCost > 0 ? 'blocked' : 'accepted' }
}
