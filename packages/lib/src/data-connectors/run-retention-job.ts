// packages/lib/src/data-connectors/run-retention-job.ts
// Nightly run-history retention. `DataConnectorRun` rows accumulate forever (a
// 15-min-cadence connector adds ~96/day), so this trims each connector back to
// its newest RUN_RETENTION_KEEP finished runs. Global (all orgs), pure count.
//
// Efficiency: a connector only GAINS runs when it syncs, and every sync ends in
// `finalizeConnector`, which bumps `DataConnector.updatedAt`. So only connectors
// touched since the last sweep can have crossed the threshold — we gate the
// window function to those active in the last RUN_RETENTION_ACTIVE_HOURS, instead
// of re-ranking every connector's full partition every night.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { JobContext } from '../jobs/types'

const logger = createScopedLogger('data-connector-run-retention')

export const DATA_CONNECTOR_RUN_RETENTION_JOB_NAME = 'dataConnectorRunRetentionJob'

/** Finished runs to keep per connector. Matches the `listRuns` API ceiling (max 200). */
const RUN_RETENTION_KEEP = 200

/**
 * Only sweep connectors whose `updatedAt` falls in this window. 25h gives a 1h
 * margin over the nightly schedule so a slightly-late run never skips a day.
 */
const RUN_RETENTION_ACTIVE_HOURS = 25

interface RunRetentionJobData {
  /** Override the per-connector keep count (default {@link RUN_RETENTION_KEEP}). */
  keep?: number
  /** Override the active-connector window in hours (default {@link RUN_RETENTION_ACTIVE_HOURS}). */
  activeHours?: number
}

/**
 * Trim each recently-active connector's run history to its newest `keep` finished
 * runs. In-flight runs (`finishedAt IS NULL`) are never eligible, so a syncing
 * connector can't lose its live run mid-flight. One windowed DELETE, backed by
 * `DataConnectorRun_dataConnectorId_startedAt_idx`.
 */
export async function dataConnectorRunRetentionJob(
  ctx: JobContext<RunRetentionJobData | undefined>
): Promise<void> {
  const keep = ctx.data?.keep ?? RUN_RETENTION_KEEP
  const activeHours = ctx.data?.activeHours ?? RUN_RETENTION_ACTIVE_HOURS

  const result = await database.execute(sql`
    WITH active AS (
      SELECT id FROM "DataConnector"
      WHERE "updatedAt" >= now() - (${activeHours} * interval '1 hour')
    ),
    ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY "dataConnectorId" ORDER BY "startedAt" DESC
      ) AS rn
      FROM "DataConnectorRun"
      WHERE "dataConnectorId" IN (SELECT id FROM active)
        AND "finishedAt" IS NOT NULL
    )
    DELETE FROM "DataConnectorRun"
    WHERE id IN (SELECT id FROM ranked WHERE rn > ${keep})
  `)

  const deleted = result.rowCount ?? 0
  if (deleted > 0) {
    logger.info('Pruned old connector runs', { deleted, keep, activeHours })
  }
}
