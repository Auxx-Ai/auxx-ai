// packages/lib/src/accounting/sales/fulfillments/accounting-sweep.ts

/**
 * Trigger 2 of the shipment poster (88 §4.5): the bounded recovery pass behind the
 * sync trigger, for a shipment whose sync was never finalized or whose refusal has
 * since been fixed. The loop is the work-item sweep frame.
 */

import type { Database } from '@auxx/database'
import { readOrganizationSettings } from '../../../settings/read'
import { runWorkItemSweep, type SweepCounts } from '../../work-items/sweep'
import { postFulfillmentAccounting } from './accounting'
import { listFulfillmentAccountingCandidates } from './posting-reads'

/** Post up to `limit` of an org's shipments: never-tried first, then due work items. */
export async function sweepFulfillmentAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SweepCounts> {
  // One settings read for the whole run rather than one refusal per shipment.
  const settings = await readOrganizationSettings(input.organizationId, [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  return runWorkItemSweep(db, {
    organizationId: input.organizationId,
    stage: 'post',
    sourceKind: 'fulfillment',
    limit: input.limit ?? 100,
    timeBudgetMs: input.timeBudgetMs,
    listFresh: (limit) =>
      listFulfillmentAccountingCandidates(db, input.organizationId, limit, {
        cutoffPeriod: settings['accounting.cutoffPeriod'],
        bookTimeZone: settings['accounting.bookTimeZone'] ?? 'UTC',
      }),
    handle: (fulfillmentId) =>
      postFulfillmentAccounting(db, { organizationId: input.organizationId, fulfillmentId }),
  })
}
