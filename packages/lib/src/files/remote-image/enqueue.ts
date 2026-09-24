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

  const deferrals = data.deferrals ?? 0
  const id = jobId(
    'record-image',
    organizationId,
    instanceId,
    fieldId,
    stableHash(url).slice(0, 16),
    ...(deferrals > 0 ? [`d${deferrals}`] : [])
  )
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
