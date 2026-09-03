// packages/lib/src/data-connectors/stale-sweep-job.ts
// §1 — global periodic stale-run sweep. Runs on the maintenance schedule (every
// 5 min) and fails any connector run whose checkpoint heartbeat went cold
// (STALE_RUN_MS), releasing its connector claim. The scoped sweep at
// `startConnectorSync` only heals the one connector being re-synced; this covers
// every connector with no human trigger, so a crashed/restarted continuation chain
// can never strand a connector `syncing` forever.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { JobContext } from '../jobs/types'
import { sweepStaleConnectorRuns, sweepStrandedConnectors } from './slice-orchestrator'

const logger = createScopedLogger('data-connector-stale-sweep')

export const DATA_CONNECTOR_STALE_SWEEP_JOB_NAME = 'dataConnectorStaleSweepJob'

/**
 * Global stale-run sweep handler. Idempotent + cheap — touches only cold runs and
 * connectors whose newest run has already ended.
 *
 * Two opposite failure shapes, one job: a chain that DIED mid-run leaves a `running` run
 * with a cold heartbeat ({@link sweepStaleConnectorRuns}); a chain that FINISHED while
 * leaking the B1 latch leaves a terminal run and a claim nobody drops
 * ({@link sweepStrandedConnectors}, task 43 D-3). Neither sweep sees the other's shape.
 */
export async function dataConnectorStaleSweepJob(
  ctx: JobContext<{ staleMs?: number } | undefined>
): Promise<void> {
  const swept = await sweepStaleConnectorRuns(database, { staleMs: ctx.data?.staleMs })
  if (swept > 0) {
    logger.warn('Swept stale connector runs', { count: swept })
  }
  const stranded = await sweepStrandedConnectors(database, { staleMs: ctx.data?.staleMs })
  if (stranded > 0) {
    logger.warn('Released stranded connectors', { count: stranded })
  }
}
