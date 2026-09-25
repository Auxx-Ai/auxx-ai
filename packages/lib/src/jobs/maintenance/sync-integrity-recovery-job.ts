// packages/lib/src/jobs/maintenance/sync-integrity-recovery-job.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { getRunManifest } from '../../data-connectors/service'
import { integrityDoor } from '../../events/handlers/sync-finalize'
import { getImportManifest } from '../../import'
import { upgradeManifestV1 } from '../../record-rules/sync-manifest-collector'
import type {
  SyncChangeManifest,
  SyncChangeManifestV1,
} from '../../record-rules/sync-manifest-types'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('sync-integrity-recovery')

/** A claim this old with the passes still pending lost its worker and its redelivery. */
const STALE_AFTER_MS = 10 * 60_000
const BATCH = 5

/** Re-runs the finalize integrity passes for runs and imports whose claimant died mid-pass. */
export async function syncIntegrityRecoveryJob(_ctx: JobContext): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  for (const source of ['connector', 'import'] as const) {
    const table = source === 'connector' ? schema.DataConnectorRun : schema.ImportJob
    const stale = await database
      .select({ id: table.id, organizationId: table.organizationId })
      .from(table)
      .where(and(isNotNull(table.integrityPendingSince), lt(table.integrityPendingSince, cutoff)))
      .limit(BATCH)
    for (const row of stale) {
      await recover(database, source, row.id, row.organizationId)
    }
  }
}

async function recover(
  db: Database,
  source: 'connector' | 'import',
  ref: string,
  organizationId: string
): Promise<void> {
  const stored: SyncChangeManifest | SyncChangeManifestV1 | null =
    source === 'connector' ? await getRunManifest(db, ref) : await getImportManifest(db, ref)
  if (!stored) {
    // Past the 48h manifest retention there is nothing to replay; the backfill scripts remain.
    logger.warn('integrity passes lost with their manifest', { organizationId, source, ref })
    const table = source === 'connector' ? schema.DataConnectorRun : schema.ImportJob
    await db.update(table).set({ integrityPendingSince: null }).where(eq(table.id, ref))
    return
  }
  const manifest = stored.version === 2 ? stored : upgradeManifestV1(stored)
  logger.info('re-running integrity passes for an interrupted finalize', {
    organizationId,
    source,
    ref,
  })
  await integrityDoor(db, organizationId, manifest, { source, ref })
}
