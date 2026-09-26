// packages/lib/src/accounting/work-items/recovery.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('accounting-work-items:recovery')

/** Run the recovery job for one org now, not at the next scheduled page; repeat calls collapse. */
export async function requestAccountingRecovery(organizationId: string): Promise<void> {
  try {
    // Lazy: the queue graph is server-only and heavy, as in `threads/mail-counts.ts`.
    const [{ getQueue }, { Queues }] = await Promise.all([
      import('../../jobs/queues'),
      import('../../jobs/queues/types'),
    ])
    // BullMQ rejects a custom jobId containing ':' ("Custom Id cannot contain :").
    await getQueue(Queues.maintenanceQueue).add(
      'accountingRecoveryJob',
      { organizationId },
      { jobId: `recovery-${organizationId}`, removeOnComplete: true, removeOnFail: true }
    )
  } catch (error) {
    logger.warn('Could not enqueue an accounting recovery run; the schedule still picks it up', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Queue `pricePartsJob` for parts that just got a standard. Never throws; falls back to recovery. */
export async function requestPartPricing(
  organizationId: string,
  partIds: readonly string[]
): Promise<void> {
  if (partIds.length === 0) return
  try {
    const [{ getQueue }, { Queues }] = await Promise.all([
      import('../../jobs/queues'),
      import('../../jobs/queues/types'),
    ])
    // No custom jobId: the pricer is idempotent, so a duplicate only re-reads an empty pending set.
    await getQueue(Queues.maintenanceQueue).add(
      'pricePartsJob',
      { organizationId, partIds: [...new Set(partIds)] },
      { removeOnComplete: true, removeOnFail: { count: 30 } }
    )
  } catch (error) {
    logger.warn('Could not enqueue part pricing; the recovery sweep prices the woken rows', {
      organizationId,
      partIds: partIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    await requestAccountingRecovery(organizationId)
  }
}
