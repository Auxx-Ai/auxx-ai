// packages/lib/src/jobs/maintenance/reconcile-record-identities-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { reconcileRecordIdentities } from '../../identity'
import type { JobContext } from '../types'

const logger = createScopedLogger('reconcile-record-identities')

interface ReconcileRecordIdentitiesJobData {
  /** Cap orgs processed per run (defence against runaway); defaults to all. */
  batchSize?: number
}

export interface ReconcileRecordIdentitiesStats {
  organizations: number
  upserted: number
  skipped: number
  orphanedDeleted: number
  errors: number
}

/**
 * Drift backstop for the `RecordIdentity` index. Any writer outside the closed
 * explicit set (connector sink, chat passport, chat JWT resolver) updates the
 * identity `FieldValue` but not the mirror, silently. This sweeps every
 * organization and rebuilds the index from `FieldValue ⋈ CustomField(isIdentity)`
 * (see {@link reconcileRecordIdentities}). Idempotent; safe to run repeatedly.
 */
export async function reconcileRecordIdentitiesJob(
  ctx: JobContext<ReconcileRecordIdentitiesJobData>
): Promise<ReconcileRecordIdentitiesStats> {
  const { batchSize } = ctx.job.data ?? {}

  const orgs = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .limit(batchSize ?? 100_000)

  const stats: ReconcileRecordIdentitiesStats = {
    organizations: orgs.length,
    upserted: 0,
    skipped: 0,
    orphanedDeleted: 0,
    errors: 0,
  }

  for (const org of orgs) {
    try {
      const result = await reconcileRecordIdentities(org.id)
      stats.upserted += result.upserted
      stats.skipped += result.skipped
      stats.orphanedDeleted += result.orphanedDeleted
    } catch (err) {
      stats.errors++
      logger.warn('Failed to reconcile record identities', {
        organizationId: org.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Record identity reconcile finished', stats)
  return stats
}
