// packages/lib/src/files/remote-image/enqueue.ts

import { createScopedLogger } from '@auxx/logger'
import { stableHash } from '@auxx/utils/hash'
import { jobId } from '../../jobs/job-id'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'

const logger = createScopedLogger('files:remote-image')

/** Must equal the key the remote-image worker maps, or `createJobHandler` never dispatches. */
export const FETCH_RECORD_IMAGE_JOB_NAME = 'fetchRecordImageJob'

export interface FetchRecordImageJobData {
  organizationId: string
  entityDefinitionId: string
  instanceId: string
  /** The `CustomField.id` of the FILE field (what `FieldValue.fieldId` carries). */
  fieldId: string
  /** The source URL exactly as the connector sent it; stored back as `sourceUrl`. */
  url: string
  connectorId?: string
  /** How many times the per-org budget has pushed this fetch back. */
  deferrals?: number
}

/**
 * Queue one record-image fetch. Keyed on the URL hash so a newer URL is not swallowed by a
 * still-queued job for the old one. Never throws: a missed image must not fail the sync.
 */
export async function enqueueRecordImageFetch(
  data: FetchRecordImageJobData,
  opts: { delayMs?: number } = {}
): Promise<boolean> {
  const { organizationId, instanceId, fieldId, url } = data
  if (!organizationId || !instanceId || !fieldId || !url) return false

  const id = recordImageJobId(data)
  try {
    await getQueue(Queues.remoteImageQueue).add(FETCH_RECORD_IMAGE_JOB_NAME, data, {
      jobId: id,
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    })
    return true
  } catch (error) {
    logger.error('Failed to enqueue record image fetch', {
      organizationId,
      instanceId,
      fieldId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** Queue many record-image fetches in one round trip. Never throws, like the single form. */
export async function enqueueRecordImageFetches(items: FetchRecordImageJobData[]): Promise<void> {
  const valid = items.filter((d) => d.organizationId && d.instanceId && d.fieldId && d.url)
  if (valid.length === 0) return
  try {
    await getQueue(Queues.remoteImageQueue).addBulk(
      valid.map((data) => ({
        name: FETCH_RECORD_IMAGE_JOB_NAME,
        data,
        opts: { jobId: recordImageJobId(data) },
      }))
    )
  } catch (error) {
    logger.error('Failed to enqueue record image fetches', {
      organizationId: valid[0]!.organizationId,
      count: valid.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function recordImageJobId(data: FetchRecordImageJobData): string {
  const deferrals = data.deferrals ?? 0
  return jobId(
    'record-image',
    data.organizationId,
    data.instanceId,
    data.fieldId,
    stableHash(data.url).slice(0, 16),
    ...(deferrals > 0 ? [`d${deferrals}`] : [])
  )
}
