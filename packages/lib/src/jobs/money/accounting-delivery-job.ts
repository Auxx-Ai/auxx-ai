// packages/lib/src/jobs/money/accounting-delivery-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { deliverAccountingPosting } from '../../postings/delivery'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:accounting-delivery')

/** Payload for {@link accountingDeliveryJob}. One accepted journal, nothing else. */
export interface AccountingDeliveryJobData {
  organizationId: string
  glPostingId: string
}

export const ACCOUNTING_DELIVERY_JOB_NAME = 'accounting-delivery'

/**
 * Push one accepted journal to the organization's pinned external books.
 *
 * 🛑 This is the SAME call the acceptance used to make inline, moved behind a
 * queue and nothing more. Delivery was already designed to be retried from
 * anywhere - it claims a lease on `AccountingDeliveryOperation`, reads the
 * remote back before it creates, and leaves a `blocked`/`uncertain` state for
 * `sweepAccountingDeliveries` when it cannot finish. Running it here rather than
 * in the request changes when it happens, not what it does.
 *
 * **Never throws.** `deliverAccountingPosting` reports a failed export on the
 * delivery row and the posting rather than raising, so a job that reaches the
 * end has succeeded even when the export did not. A throw here would earn a
 * BullMQ retry on top of delivery's own `nextAttemptAt` backoff and the
 * recovery sweep - three retry mechanisms for one operation.
 */
export const accountingDeliveryJob = async (ctx: JobContext<AccountingDeliveryJobData>) => {
  const { organizationId, glPostingId } = ctx.data
  try {
    const result = await deliverAccountingPosting(db, { organizationId, glPostingId })
    if (result.exportStatus === 'failed')
      logger.warn('Accounting delivery did not export; recovery will retry', {
        organizationId,
        glPostingId,
        error: 'error' in result ? result.error : undefined,
      })
    return result
  } catch (error) {
    logger.error('Accounting delivery job failed; recovery will retry', {
      organizationId,
      glPostingId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
