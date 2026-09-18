// packages/lib/src/jobs/money/export-batch-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sendExportBatch } from '../../accounting/export'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:export-batch')

/** Payload for {@link exportBatchJob}. One batch, nothing else. */
export interface ExportBatchJobData {
  organizationId: string
  batchId: string
}

export const EXPORT_BATCH_JOB_NAME = 'export-batch'

/**
 * Send one export batch to the organization's pinned books.
 *
 * **Never throws.** `sendExportBatch` records a refusal on the batch rather than
 * raising, so a job that reaches the end has succeeded even when the send did
 * not. A throw here would earn a BullMQ retry on top of the batch's own
 * `nextAttemptAt` backoff and the sweep - three retry mechanisms for one send.
 */
export const exportBatchJob = async (ctx: JobContext<ExportBatchJobData>) => {
  const { organizationId, batchId } = ctx.data
  try {
    const result = await sendExportBatch(db, { organizationId, batchId })
    if (result.isErr()) {
      logger.warn('Export batch job could not send; the sweep will retry', {
        organizationId,
        batchId,
        error: result.error.message,
      })
      return undefined
    }
    if (result.value.status === 'failed')
      logger.warn('Export batch did not send; the sweep will retry', {
        organizationId,
        batchId,
        error: result.value.error,
      })
    return result.value
  } catch (error) {
    logger.error('Export batch job failed; the sweep will retry', {
      organizationId,
      batchId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
