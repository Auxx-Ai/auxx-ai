// packages/lib/src/jobs/maintenance/data-deletion-job.ts
// Per-request teardown for one `DataDeletionRequest`
// (plans/channels/meta-data-deletion-callback.md §4.4).
//
// NOT a sweep and NOT scheduled: one job per inbound callback, enqueued by the
// Meta `signed_request` routes and the Shopify compliance webhook right after
// `createDeletionRequest` has minted the confirmation code that already went
// back in the 200 response.
//
// Async on purpose. The teardown makes several Graph calls per channel, and
// running it inline would put Meta's callback timeout behind Facebook's own API
// latency — a compliance endpoint that times out is a compliance endpoint that
// gets retried in a storm.
//
// Thin BullMQ glue, the `mail-unsubscribe-sweep-job.ts` shape: the whole
// teardown lives in `@auxx/lib/data-deletion`'s `executeDeletionRequest`, which
// takes `db` and is therefore testable without a queue.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type DeletionRequestOutcome, executeDeletionRequest } from '../../data-deletion/execute'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:data-deletion')

export const DATA_DELETION_JOB_NAME = 'dataDeletionJob'

export interface DataDeletionJobData {
  /** `DataDeletionRequest.id` — the pk, never the public confirmation code. */
  requestId: string
}

/**
 * Execute one recorded deletion / deauthorize / Shopify-compliance request.
 *
 * `executeDeletionRequest` branches on `kind` and owns every decision: which
 * channels resolve (snapshotted before the first revoke, because `revokeAccess`
 * nulls the `metadata.userId` the lookup keys on), revoke + soft-delete for
 * `data_deletion` vs disable-only for `deauthorize`, the org notification and
 * email, and parking the three Shopify kinds in `processing` behind their
 * `TODO(shopify-redact)` so the outstanding obligation stays visible.
 *
 * ⚠️ **Retry safety.** This job revokes OAuth tokens, so a retry must not be
 * able to do damage twice. Two things make that true, and both live in the lib
 * module rather than here:
 * 1. A request already at `status: 'completed'` returns immediately as a no-op
 *    — that guard is what makes a redelivered or retried job safe.
 * 2. A retry after a partial failure re-resolves the channel set first, and any
 *    channel already revoked no longer matches the resolver (its
 *    `metadata.userId` is gone), so it is simply not touched again. Resolving
 *    zero channels is a SUCCESS, not an error (plan §7.6/§7.7).
 *
 * Failures are rethrown so BullMQ retries them; the row is already stamped
 * `failed` with the message by the time we get here.
 */
export async function dataDeletionJob(
  ctx: JobContext<DataDeletionJobData>
): Promise<DeletionRequestOutcome> {
  const { requestId } = ctx.data

  const result = await executeDeletionRequest(database, requestId)
  if (result.isErr()) {
    logger.error('Data-deletion request failed', { requestId, error: result.error.message })
    throw result.error
  }

  logger.info('Data-deletion request executed', result.value)
  return result.value
}

/**
 * Enqueue the teardown for one recorded request on the maintenance queue.
 *
 * `jobId` is keyed on the request id, not on the provider's external id: each
 * inbound callback mints its own row and is owed its own teardown (a person may
 * connect → delete → reconnect → delete again, plan §7.7), while a duplicate
 * enqueue *of the same row* is pure noise and worth collapsing.
 */
export async function enqueueDataDeletionJob(data: DataDeletionJobData): Promise<void> {
  const { getQueue } = await import('../queues')
  const { Queues } = await import('../queues/types')
  const queue = getQueue(Queues.maintenanceQueue)

  await queue.add(DATA_DELETION_JOB_NAME, data, {
    jobId: `data-deletion:${data.requestId}`,
    // Safe to retry — see the guard note on `dataDeletionJob` above. Worth
    // retrying, too: a transient Graph or DB blip on a compliance obligation
    // should not need a human.
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
    priority: 5,
  })

  logger.info('Enqueued data-deletion job', { requestId: data.requestId })
}
