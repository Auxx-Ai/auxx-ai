// packages/lib/src/jobs/maintenance/price-parts-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { publishAccountingWork } from '../../accounting/work-items/realtime'
import { requestAccountingRecovery } from '../../accounting/work-items/recovery'
import { pricePendingMovements } from '../../inventory/costing/price-pending-movements'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('price-parts-job')

/** Parts that just got a standard; their `pending` rows are valued here, off the save request. */
export interface PricePartsJobData {
  organizationId: string
  partIds: string[]
}

/** Price every pending row of the named parts, then run recovery for whatever is left. */
export async function pricePartsJob(ctx: JobContext<PricePartsJobData | undefined>): Promise<void> {
  const organizationId = ctx.data?.organizationId
  const partIds = ctx.data?.partIds ?? []
  if (!organizationId || partIds.length === 0) {
    logger.warn('Dropping a price-parts job with no org or parts', { jobId: ctx.jobId })
    return
  }

  const priced = await pricePendingMovements(database, organizationId, partIds)
  if (priced.isErr()) {
    // The woken `price` work items are the backstop; recovery below retries them.
    logger.error('Pricing parts failed', {
      organizationId,
      partIds: partIds.length,
      error: priced.error.message,
    })
  } else {
    const summary = priced.value
    logger.info('Priced parts', {
      organizationId,
      partIds: partIds.length,
      movements: summary.pricedMovementIds.length,
      unpricedParts: summary.unpricedPartIds.length,
      documentsPosted: summary.documentsPosted,
      documentsFailed: summary.documentsFailed,
      finishedBuilds: summary.finishedBuildIds.length,
    })
    // The Blocked tab refetches on this frame; the pricer clears items without a sweep to send it.
    if (summary.pricedMovementIds.length > 0) {
      await publishAccountingWork(organizationId, {
        stage: 'price',
        sourceKind: 'stock_movement',
        scanned: summary.pricedMovementIds.length,
        accepted: summary.pricedMovementIds.length,
      })
    }
  }
  await requestAccountingRecovery(organizationId)
}
