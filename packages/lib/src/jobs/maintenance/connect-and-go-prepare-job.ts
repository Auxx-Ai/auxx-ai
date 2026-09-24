// packages/lib/src/jobs/maintenance/connect-and-go-prepare-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { prepareConnectAndGo } from '../../accounting/connect-and-go/prepare'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('connect-and-go-prepare-job')

const payloadSchema = z.object({
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
})

/** Queued when an accounting provider connects; the setup screen re-runs the same thing on open. */
export async function connectAndGoPrepareJob(ctx: JobContext): Promise<void> {
  const input = payloadSchema.parse(ctx.data)
  const result = await prepareConnectAndGo(database, input)
  if (result.isErr()) {
    logger.warn('Connect and go prepare refused', {
      organizationId: input.organizationId,
      error: result.error.message,
    })
    return
  }
  logger.info('Connect and go prepare finished', {
    organizationId: input.organizationId,
    failures: result.value.failures.length,
  })
}
