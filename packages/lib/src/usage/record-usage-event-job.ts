// packages/lib/src/usage/record-usage-event-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { JobContext } from '../jobs/types/job-context'
import type { RecordUsageEventJobData } from './types'

const logger = createScopedLogger('record-usage-event-job')

/**
 * BullMQ job handler: writes a usage event to Postgres for durable audit trail.
 * Called fire-and-forget from UsageCounter after a successful Redis increment.
 */
export async function recordUsageEventJob(ctx: JobContext<RecordUsageEventJobData>): Promise<void> {
  const { orgId, metric, quantity, userId, metadata, periodKey } = ctx.data

  await db.insert(schema.UsageEvent).values({
    organizationId: orgId,
    userId: userId ?? null,
    metric,
    quantity,
    metadata: metadata ?? null,
    periodKey,
  })

  logger.debug('Recorded usage event', { orgId, metric, quantity, periodKey })
}
