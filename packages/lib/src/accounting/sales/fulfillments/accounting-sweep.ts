// packages/lib/src/accounting/sales/fulfillments/accounting-sweep.ts

/**
 * Trigger 2 of the shipment poster (88 §4.5): the bounded recovery pass behind
 * the sync trigger, for a shipment whose sync was never finalized, whose order
 * was not ready at the time, or whose refusal has since been fixed.
 *
 * Its candidate query is {@link listFulfillmentAccountingCandidates}; this file
 * is only the loop, on `money/blocked-movements.ts`'s shape.
 */

import type { Database } from '@auxx/database'
import { readOrganizationSettings } from '../../../settings/read'
import { POSTING_RETRY_INTERVAL_MS } from '../../money/blocked-movements'
import { postFulfillmentAccounting } from './accounting'
import { listFulfillmentAccountingCandidates } from './posting-reads'

/**
 * Post up to `limit` of an org's unposted shipments, oldest shipment first.
 *
 * ⚠️ An order whose receipt and shipment each wait on the other converges
 * across passes, not within one - Trigger 1 is what keeps a live sync from ever
 * waiting on this.
 */
export async function sweepFulfillmentAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<{
  scanned: number
  accepted: number
  drafted: number
  blocked: number
  skipped: number
}> {
  const started = Date.now()
  // Hoisted, so the window is one settings read for the whole run rather than
  // one refusal per shipment.
  const settings = await readOrganizationSettings(input.organizationId, [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  const candidates = await listFulfillmentAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500),
    {
      cutoffPeriod: settings['accounting.cutoffPeriod'],
      bookTimeZone: settings['accounting.bookTimeZone'] ?? 'UTC',
      retryBefore: new Date(started - POSTING_RETRY_INTERVAL_MS),
    }
  )
  const counts = { scanned: 0, accepted: 0, drafted: 0, blocked: 0, skipped: 0 }
  for (const fulfillmentId of candidates) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    counts.scanned++
    try {
      const result = await postFulfillmentAccounting(db, {
        organizationId: input.organizationId,
        fulfillmentId,
      })
      counts[result.status]++
    } catch {
      // A shipment whose record has gone is not postable by anybody; the sweep
      // counts it and moves on rather than ending the page.
      counts.blocked++
    }
  }
  return counts
}
