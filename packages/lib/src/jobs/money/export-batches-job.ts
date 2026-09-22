// packages/lib/src/jobs/money/export-batches-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sendExportBatches } from '../../accounting/export'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:export-batches')

/** Payload for {@link exportBatchesJob}: at most `EXPORT_BATCHES_PER_JOB` ids from one release. */
export interface ExportBatchesJobData {
  organizationId: string
  batchIds: string[]
  runId?: string
  /** Enqueued by a person's Retry, so the send resets `attempts`. */
  manual?: boolean
}

export const EXPORT_BATCHES_JOB_NAME = 'export-batches'

/**
 * Send a released set of export batches in as few provider calls as it allows.
 *
 * **Never throws**, for the reason `exportBatchJob` gives: every refusal is recorded on
 * its batch, and the sweep plus `nextAttemptAt` are the retry, not BullMQ.
 */
export const exportBatchesJob = async (ctx: JobContext<ExportBatchesJobData>) => {
  const { organizationId, batchIds, runId, manual } = ctx.data
  try {
    const result = await sendExportBatches(db, {
      organizationId,
      batchIds,
      ...(runId ? { runId } : {}),
      ...(manual ? { manual } : {}),
    })
    if (result.isErr()) {
      logger.warn('Export batches job could not send; the sweep will retry', {
        organizationId,
        batches: batchIds.length,
        error: result.error.message,
      })
      return undefined
    }
    return result.value
  } catch (error) {
    logger.error('Export batches job failed; the sweep will retry', {
      organizationId,
      batches: batchIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
