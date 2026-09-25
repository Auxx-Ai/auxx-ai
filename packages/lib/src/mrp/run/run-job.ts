// packages/lib/src/mrp/run/run-job.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createCredentialLockProvider } from '@auxx/redis'
import { isNull } from 'drizzle-orm'
import pLimit from 'p-limit'
import { compareFactsToLedger } from '../../inventory/movements/fact/drift-check'
import { readFactTotalsByPart } from '../../inventory/movements/fact/reads'
import { rebuildMovementFacts } from '../../inventory/movements/fact/rebuild'
import { jobId } from '../../jobs/job-id'
import { getQueue, Queues } from '../../jobs/queues'
import type { JobContext } from '../../jobs/types/job-context'
import { readOrganizationSettings } from '../../settings/read'
import { isMrpEnabled } from '../guard'
import { runMrpPlan } from './run'
import { failStaleRuns, type MrpRunTrigger, pruneRuns } from './write-run'

const logger = createScopedLogger('mrp')

/** BullMQ job name of the per-org run on the maintenance queue. */
export const MRP_RUN_ORG_JOB = 'mrpRunOrgJob'

export interface MrpRunOrgJobData {
  organizationId: string
  trigger: MrpRunTrigger
}

/** Orgs planned at once in the nightly sweep. */
const NIGHTLY_CONCURRENCY = 2
/** Outlives any real run; only a crashed worker leaves it to expire. */
const LOCK_TTL_SECONDS = 30 * 60
const DEFAULT_RETENTION_DAYS = 90
/** A run still `running` after this is orphaned; the lock TTL is far shorter. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000
const ACTIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'])

const lockKey = (organizationId: string) => `mrp-run-lock:${organizationId}`
const runJobId = (organizationId: string) => jobId('mrp-run', organizationId)

export type MrpOrgRunOutcome = 'completed' | 'failed' | 'skipped_locked' | 'skipped_disabled'

/** One org's run under its Redis lock: mirror bootstrap, the plan, then retention (08 §5). */
export async function runMrpForOrganization(
  db: Database,
  organizationId: string,
  trigger: MrpRunTrigger
): Promise<MrpOrgRunOutcome> {
  const log = logger.with({ organizationId, trigger })
  if (!(await isMrpEnabled(organizationId))) {
    log.info('MRP not on the org plan, skipping')
    return 'skipped_disabled'
  }

  const lock = createCredentialLockProvider()
  let locked = false
  try {
    locked = await lock.acquire(lockKey(organizationId), LOCK_TTL_SECONDS)
    if (!locked) {
      log.info('MRP run already in progress, skipping')
      return 'skipped_locked'
    }
  } catch {
    // Redis down: run unlocked; the jobId still dedupes the queue.
    log.warn('Redis unavailable, running MRP unlocked')
  }

  try {
    const stale = await failStaleRuns(db, organizationId, STALE_RUN_MS)
    if (stale.isErr()) log.warn('Could not fail orphaned MRP runs', { error: stale.error.message })
    else if (stale.value.failed > 0) log.warn('Failed orphaned MRP runs', stale.value)

    // TODO(111 X5): run backflushBuilds(orgId, { from: yesterday, to: yesterday }) here when inventory.backflush is on
    await bootstrapMirror(db, organizationId)

    const run = await runMrpPlan(db, organizationId, { trigger })
    if (run.isErr()) {
      log.error('MRP run failed', { error: run.error.message })
      return 'failed'
    }

    const settings = await readOrganizationSettings(organizationId, ['mrp.runRetentionDays'])
    const retention = settings['mrp.runRetentionDays']
    const pruned = await pruneRuns(
      db,
      organizationId,
      typeof retention === 'number' && retention > 0 ? retention : DEFAULT_RETENTION_DAYS
    )
    if (pruned.isErr()) log.warn('MRP run pruning failed', { error: pruned.error.message })
    return 'completed'
  } finally {
    if (locked) await lock.release(lockKey(organizationId)).catch(() => undefined)
  }
}

/** An org that predates the mirror has ledger rows and no facts: replay it once before planning. */
async function bootstrapMirror(db: Database, organizationId: string): Promise<void> {
  const facts = await readFactTotalsByPart(db, organizationId)
  if (facts.size > 0) return
  const drift = await compareFactsToLedger(db, organizationId)
  if (drift.isErr()) throw drift.error
  if (!drift.value.some((d) => d.ledgerCount > 0)) return
  logger.info('Movement mirror empty, rebuilding from the ledger', { organizationId })
  const rebuilt = await rebuildMovementFacts(db, organizationId)
  if (rebuilt.isErr()) throw rebuilt.error
}

/** Nightly sweep: every enabled org with MRP, each in its own try (D40). */
export async function mrpNightlyJob(ctx: JobContext): Promise<void> {
  const orgs = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .where(isNull(schema.Organization.disabledAt))
  const limit = pLimit(NIGHTLY_CONCURRENCY)
  const outcomes = await Promise.all(
    orgs.map((org) =>
      limit(async (): Promise<MrpOrgRunOutcome> => {
        try {
          return await runMrpForOrganization(database, org.id, 'nightly')
        } catch (error) {
          logger.error('MRP nightly run threw', {
            organizationId: org.id,
            error: error instanceof Error ? error.message : String(error),
          })
          return 'failed'
        }
      })
    )
  )
  const summary: Record<string, number> = {}
  for (const outcome of outcomes) summary[outcome] = (summary[outcome] ?? 0) + 1
  logger.info('MRP nightly sweep finished', { jobId: ctx.jobId, orgs: orgs.length, ...summary })
}

/** One org on demand ("Run now") or re-queued; a failed plan throws so BullMQ's attempts retry it. */
export async function mrpRunOrgJob(ctx: JobContext<MrpRunOrgJobData>): Promise<MrpOrgRunOutcome> {
  const { organizationId, trigger } = ctx.data
  const outcome = await runMrpForOrganization(database, organizationId, trigger ?? 'manual')
  if (outcome === 'failed') throw new Error(`MRP run failed for organization ${organizationId}`)
  return outcome
}

/** Queue a run for one org; a second call while one is queued or running adds nothing. */
export async function enqueueMrpRun(
  organizationId: string,
  input: { trigger: MrpRunTrigger }
): Promise<{ queued: boolean }> {
  if (await isMrpRunActive(organizationId)) return { queued: false }
  const queue = getQueue(Queues.maintenanceQueue)
  await queue.add(
    MRP_RUN_ORG_JOB,
    { organizationId, trigger: input.trigger } satisfies MrpRunOrgJobData,
    {
      jobId: runJobId(organizationId),
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      // Removed when done, or a finished job would hold the id and swallow the next enqueue.
      removeOnComplete: true,
      removeOnFail: true,
    }
  )
  return { queued: true }
}

/** Whether a run for the org is queued, retrying or running, including the nightly sweep's. */
export async function isMrpRunActive(organizationId: string): Promise<boolean> {
  const job = await getQueue(Queues.maintenanceQueue).getJob(runJobId(organizationId))
  if (job && ACTIVE_STATES.has(await job.getState())) return true
  try {
    return await createCredentialLockProvider().isHeld(lockKey(organizationId))
  } catch {
    return false
  }
}
