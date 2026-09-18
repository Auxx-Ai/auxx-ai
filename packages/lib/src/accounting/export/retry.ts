// packages/lib/src/accounting/export/retry.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { type SendExportBatchResult, sendExportBatch } from './send'

/**
 * Send a failed batch again, now.
 *
 * The one-row door, and the only one left once the sweep's attempt budget is
 * spent. It resets that budget, because a person pressing it has asserted that
 * whatever blocked the batch is fixed.
 */
export async function retryExportBatch(
  db: Database,
  input: { organizationId: string; batchId: string }
): Promise<Result<SendExportBatchResult, Error>> {
  return sendExportBatch(db, { ...input, manual: true })
}
