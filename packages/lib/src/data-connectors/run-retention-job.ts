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
//
// It also clears the `manifest` jsonb off runs past the consumer window. A manifest
// reaches ~16MB, so the 200 kept runs are otherwise ~3GB of dead weight per connector.

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

/**
 * Age past which a finished run's `manifest` is cleared. The `sync:records:changed`
 * consumers read it within seconds of finalize; 48h covers any redelivery. Not keyed
 * on `manifestConsumedAt` — that latch is only ever stamped by the record-rules
 * consumer, so an org with no rules would keep every manifest forever.
 */
const MANIFEST_RETENTION_HOURS = 48

/** Runs whose manifest is cleared per statement, so one sweep can't rewrite a huge toast set at once. */
const MANIFEST_CLEAR_BATCH = 500

interface RunRetentionJobData {
  /** Override the per-connector keep count (default {@link RUN_RETENTION_KEEP}). */
  keep?: number
  /** Override the active-connector window in hours (default {@link RUN_RETENTION_ACTIVE_HOURS}). */
  activeHours?: number
  /** Override the manifest-clear age in hours (default {@link MANIFEST_RETENTION_HOURS}). */
  manifestHours?: number
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

  const cleared = await clearAgedManifests(ctx.data?.manifestHours ?? MANIFEST_RETENTION_HOURS)
  if (cleared > 0) {
    logger.info('Cleared aged run manifests', { cleared })
  }
}

/**
 * Null the `manifest` jsonb on finished runs older than `hours`, in batches until
 * none remain. Survivors keep their counters, `errorSample` and `progress` — the
 * whole run history still renders, only the worker-internal change set goes.
 */
async function clearAgedManifests(hours: number): Promise<number> {
  let cleared = 0
  for (;;) {
    const result = await database.execute(sql`
      UPDATE "DataConnectorRun" SET manifest = NULL
      WHERE id IN (
        SELECT id FROM "DataConnectorRun"
        WHERE manifest IS NOT NULL
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" < now() - (${hours} * interval '1 hour')
        LIMIT ${MANIFEST_CLEAR_BATCH}
      )
    `)
    const n = result.rowCount ?? 0
    cleared += n
    if (n < MANIFEST_CLEAR_BATCH) return cleared
  }
}
