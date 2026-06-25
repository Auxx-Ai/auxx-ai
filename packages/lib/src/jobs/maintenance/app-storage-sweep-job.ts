// packages/lib/src/jobs/maintenance/app-storage-sweep-job.ts

import { createScopedLogger } from '@auxx/logger'
import { countExpiredAppStorage, deleteExpiredAppStorage } from '../../apps/app-storage'
import type { JobContext } from '../types'

const logger = createScopedLogger('app-storage-sweep')

/** Runaway guard — a single run deletes at most MAX_BATCHES × batchSize rows. */
const MAX_BATCHES = 50

interface AppStorageSweepJobData {
  /** Rows deleted per batch. Defaults to 1,000. */
  batchSize?: number
  /** Count expired rows without deleting. */
  dryRun?: boolean
}

export interface AppStorageSweepStats {
  deleted: number
  batches: number
}

/**
 * Delete expired `AppStorage` rows (hygiene — reads already filter expired rows
 * via lazy expiry, so cadence is non-critical). Drains in batches until a batch
 * comes back short or the iteration cap is hit. `dryRun` reports the expired
 * count without deleting.
 */
export async function appStorageSweepJob(
  ctx: JobContext<AppStorageSweepJobData>
): Promise<AppStorageSweepStats> {
  const job = ctx.job
  const { batchSize = 1000, dryRun = false } = job.data
  logger.info('Starting app storage sweep', { batchSize, dryRun })

  if (dryRun) {
    const result = await countExpiredAppStorage()
    const deleted = result.isOk() ? result.value : 0
    logger.info('App storage sweep dry run', { expired: deleted })
    return { deleted, batches: 0 }
  }

  let deleted = 0
  let batches = 0

  for (let i = 0; i < MAX_BATCHES; i++) {
    const result = await deleteExpiredAppStorage(batchSize)
    if (result.isErr()) {
      logger.warn('App storage sweep batch failed', { error: result.error.message })
      break
    }
    deleted += result.value
    batches++
    if (result.value < batchSize) break
  }

  logger.info('App storage sweep finished', { deleted, batches })
  return { deleted, batches }
}
