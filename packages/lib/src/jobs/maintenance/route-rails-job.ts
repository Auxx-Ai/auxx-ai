// packages/lib/src/jobs/maintenance/route-rails-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { autoRouteRails } from '../../accounting/connect-and-go/auto-route-rails'
import { withSetupLock } from '../../accounting/connect-and-go/lock'
import { FINALIZED_SETUP_STATE } from '../../accounting/ledger/setup/setup-readiness'
import { getOrgCache } from '../../cache'
import { ConflictError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('route-rails-job')

const payloadSchema = z.object({ organizationId: z.string().min(1) })

/** Routes rails that appeared after setup (118 §2). Before Finalize, prepare routes them itself. */
export async function routeRailsJob(ctx: JobContext): Promise<void> {
  const { organizationId } = payloadSchema.parse(ctx.data)
  const settings = await readOrganizationSettings(
    organizationId,
    ['accounting.setupState'] as const,
    database
  )
  if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE) return

  const actorUserId = await getOrgCache().get(organizationId, 'systemUser')
  let result: Awaited<ReturnType<typeof autoRouteRails>>
  try {
    result = await withSetupLock(database, organizationId, () =>
      autoRouteRails(database, { organizationId, actorUserId })
    )
  } catch (error) {
    // A running prepare routes rails too.
    if (error instanceof ConflictError) return
    throw error
  }
  if (result.isErr()) {
    logger.warn('Rail routing refused', { organizationId, error: result.error.message })
    return
  }
  const { created, banked, questions, failed } = result.value
  if (created.length + banked.length + failed.length === 0) return
  logger.info('Routed rails after setup', {
    organizationId,
    created: created.length,
    banked: banked.length,
    questions: questions.length,
    failed: failed.length,
  })
}
