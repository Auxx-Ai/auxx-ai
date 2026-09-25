// packages/lib/src/data-migrations/migrations/192-retry-period-locked-work-items.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-192')

/** The retired code: the month lock no longer refuses a post (plan 104 P1b). */
export const RETIRED_PERIOD_LOCKED_CODE = 'PERIOD_LOCKED'

/** Makes every parked `PERIOD_LOCKED` work item due now, so the sweep retries it and it posts. */
export const migration192RetryPeriodLockedWorkItems: DataMigrationDef = {
  id: '192-retry-period-locked-work-items',
  description:
    'Wake every PERIOD_LOCKED accounting work item: the month lock no longer refuses, so a retry posts it',
  async run(db) {
    const now = new Date()
    const woken = await db
      .update(schema.AccountingWorkItem)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(eq(schema.AccountingWorkItem.reasonCode, RETIRED_PERIOD_LOCKED_CODE))
      .returning({ id: schema.AccountingWorkItem.id })
    logger.info('Woke PERIOD_LOCKED work items for retry', { count: woken.length })
  },
}
