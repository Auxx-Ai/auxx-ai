// packages/lib/src/companies/enrichment/enqueue.ts
// Every door's actual call. Enqueue, never enrich inline.
//
// Inline was viable while `created` was the only door: `fanOutEntityHandler` awaits each
// record in turn inside ONE events-queue job, and a company costs up to 8s of HTML plus 5s
// of logo. A 315-row import therefore held an events-worker slot for the better part of an
// hour, head-of-line blocking every unrelated event behind it. v3 called this out as the
// trigger for a dedicated queue ("If enrichment ever needs to fan out ... that's when a
// dedicated queue makes sense"), and three more doors is that moment.

import { createScopedLogger } from '@auxx/logger'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import type { EnrichReason } from './guards'

const logger = createScopedLogger('companies:enrichment')

/** Must equal the key the enrichment worker maps, or `createJobHandler` never dispatches. */
export const ENRICH_COMPANY_JOB_NAME = 'enrichCompanyJob'

export interface EnrichCompanyJobData {
  organizationId: string
  companyInstanceId: string
  reason: EnrichReason
}

/**
 * Queue one company for enrichment.
 *
 * The `jobId` is the first of the four throttle layers: BullMQ drops an `add` whose custom
 * id is already live, which collapses the sync-door double-fire (an import creating a
 * company with a domain fires BOTH the lifecycle rule and the `company_domain` field rule,
 * because `skipOnCreate` is only honoured on the interactive path) and any burst of saves
 * before the job runs. It is only a first line of defence: BullMQ forgets the id once the
 * job completes and is removed, so the durable guard is the stored
 * `company_enrichment_status` that `shouldEnrich` reads.
 *
 * ⚠️ Hyphens, not colons. BullMQ rejects a custom `jobId` containing `:` unless it splits
 * into exactly three parts, and the resulting throw would be swallowed by the catch below,
 * silently enqueueing nothing at all.
 *
 * Never throws: an enrichment that did not get queued must not fail the write that
 * triggered it, nor spend the originating event handler's retry budget.
 */
export async function enqueueCompanyEnrichment(args: EnrichCompanyJobData): Promise<boolean> {
  const { organizationId, companyInstanceId, reason } = args
  if (!organizationId || !companyInstanceId) return false

  try {
    await getQueue(Queues.enrichmentQueue).add(
      ENRICH_COMPANY_JOB_NAME,
      { organizationId, companyInstanceId, reason },
      { jobId: `enrich-company-${organizationId}-${companyInstanceId}` }
    )
    return true
  } catch (error) {
    logger.error('Failed to enqueue company enrichment', {
      organizationId,
      companyId: companyInstanceId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
