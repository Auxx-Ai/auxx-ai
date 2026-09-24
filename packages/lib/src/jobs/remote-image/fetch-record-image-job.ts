// packages/lib/src/jobs/remote-image/fetch-record-image-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  enqueueRecordImageFetch,
  type FetchRecordImageJobData,
} from '../../files/remote-image/enqueue'
import { fetchRecordImage } from '../../files/remote-image/fetch-record-image'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('fetch-record-image-job')

/** Fetch one connector image. Throws only on a transient failure, so BullMQ's retries apply. */
export async function fetchRecordImageJob(ctx: JobContext<FetchRecordImageJobData>): Promise<void> {
  const data = ctx.data
  const result = await fetchRecordImage(database, data)
  if (result.isErr()) throw result.error

  const outcome = result.value
  if (outcome.outcome === 'deferred') {
    // Over the per-org budget: push back rather than drop, so a big backfill completes slower.
    await enqueueRecordImageFetch(
      { ...data, deferrals: (data.deferrals ?? 0) + 1 },
      { delayMs: outcome.retryInMs }
    )
  }
  logger.debug('Record image job finished', {
    jobId: ctx.jobId,
    orgId: data.organizationId,
    recordId: data.instanceId,
    ...outcome,
  })
}
