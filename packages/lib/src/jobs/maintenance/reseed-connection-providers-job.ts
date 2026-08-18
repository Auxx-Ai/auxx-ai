// packages/lib/src/jobs/maintenance/reseed-connection-providers-job.ts

import { configService } from '@auxx/credentials'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ensurePlatformProviders } from '../../connections/providers'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('reseed-connection-providers-job')

/** Fixed jobId so repeat clicks coalesce while one run is queued/active. */
const RESEED_JOB_ID = 'reseed-connection-providers'

/**
 * Re-upsert the platform built-in `ConnectionDefinition` rows from the deployed
 * catalog + the current config.
 *
 * **This exists so rotating a platform OAuth client is not a release.** The rows
 * bake an ENCRYPTED copy of the client id/secret at seed time (`§9.3` — it keeps
 * the runtime resolution path uniform with app/mcp definitions, with no env
 * branch), and the only writers were the seed CLI, a local script, and a
 * one-line data migration. So the emergency path for a compromised app secret
 * was "author migration NNN, open a PR, wait for a full deploy" — half an hour,
 * to re-run an idempotent function that takes milliseconds.
 *
 * Runs **on the worker** deliberately: the values come from that process's
 * resolved config, and the worker is the process that has always applied these
 * (via `dataMigrationsJob`). Running it from the web request would bake whatever
 * the web service's env happens to hold.
 *
 * Scope, and what it does NOT cover: this re-bakes what the DEPLOYED catalog
 * says. A change to `defs.ts` itself — new scopes, a `global` flip, new
 * connection variables — is code and still ships with a release; this button
 * then applies it without also needing a migration id. Only the config-sourced
 * client id/secret can change with no deploy at all.
 *
 * Idempotent: `ensurePlatformProviders` SELECTs by `(providerKey, major)` and
 * UPDATEs in place, so row ids — and every `Credential.connectionDefinitionId`
 * FK pointing at them — survive. Safe to run at any time.
 */
export async function reseedConnectionProvidersJob(ctx: JobContext): Promise<{ reseeded: true }> {
  logger.info('Reseeding platform connection providers', { jobId: ctx.jobId })
  // The admin wrote the new value in the WEB process; this cache lives in the
  // worker and otherwise refreshes on a 5-minute timer. Without this the job
  // cheerfully re-bakes the previous secret and reports success.
  await configService.refresh()
  await ensurePlatformProviders(db)
  logger.info('Reseeded platform connection providers', { jobId: ctx.jobId })
  return { reseeded: true }
}

/**
 * Enqueue a reseed on the maintenance queue. `attempts: 1` — a failure is worth
 * looking at rather than retrying blindly against the same config.
 */
export async function enqueueReseedConnectionProviders(): Promise<void> {
  const { getQueue } = await import('../queues')
  const { Queues } = await import('../queues/types')
  const queue = getQueue(Queues.maintenanceQueue)

  await queue.add(
    'reseedConnectionProvidersJob',
    {},
    {
      jobId: RESEED_JOB_ID,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
      priority: 5,
    }
  )

  logger.info('Enqueued connection-provider reseed')
}
