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
import { sweepStaleConnectorRuns } from './slice-orchestrator'

const logger = createScopedLogger('data-connector-stale-sweep')

export const DATA_CONNECTOR_STALE_SWEEP_JOB_NAME = 'dataConnectorStaleSweepJob'

/** Global stale-run sweep handler. Idempotent + cheap — touches only cold runs. */
export async function dataConnectorStaleSweepJob(
  ctx: JobContext<{ staleMs?: number } | undefined>
): Promise<void> {
  const swept = await sweepStaleConnectorRuns(database, { staleMs: ctx.data?.staleMs })
  if (swept > 0) {
    logger.warn('Swept stale connector runs', { count: swept })
  }
}
