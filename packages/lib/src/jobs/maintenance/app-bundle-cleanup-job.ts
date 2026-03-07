// packages/lib/src/jobs/maintenance/app-bundle-cleanup-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getBundleS3Key } from '@auxx/services/app-bundles'
import type { Job } from 'bullmq'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { S3Adapter } from '../../files/adapters/s3-adapter'

const logger = createScopedLogger('app-bundle-cleanup')

interface AppBundleCleanupJobData {
  batchSize?: number
  dryRun?: boolean
}

export async function orphanedAppBundleCleanupJob(job: Job<AppBundleCleanupJobData>) {
  const { batchSize = 100, dryRun = false } = job.data

  const s3Adapter = new S3Adapter()
  const auth = s3Adapter.resolvePlatformAuth()
  if (!auth) {
    logger.error('S3 platform auth not configured, skipping cleanup')
    return { found: 0, deleted: 0, errors: 0 }
  }

  logger.info('Starting orphaned app bundle cleanup', { batchSize, dryRun })

  // Age threshold: only consider bundles older than 1 hour.
  // This prevents deleting bundles that are still in-flight
  // (registered via /bundles/check but not yet confirmed via /bundles/confirm).
  const ageThreshold = new Date(Date.now() - 60 * 60 * 1000)

  // Find AppBundle rows not referenced by any AppDeployment.
  const orphans = await database
    .select({
      id: schema.AppBundle.id,
      appId: schema.AppBundle.appId,
      bundleType: schema.AppBundle.bundleType,
      sha256: schema.AppBundle.sha256,
    })
    .from(schema.AppBundle)
    .leftJoin(
      schema.AppDeployment,
      or(
        eq(schema.AppBundle.id, schema.AppDeployment.clientBundleId),
        eq(schema.AppBundle.id, schema.AppDeployment.serverBundleId)
      )
    )
    .where(and(isNull(schema.AppDeployment.id), lt(schema.AppBundle.createdAt, ageThreshold)))
    .limit(batchSize)

  logger.info(`Found ${orphans.length} orphaned bundles`)

  let deleted = 0
  let errors = 0

  for (const bundle of orphans) {
    try {
      if (!dryRun) {
        // Delete from DB first, then S3.
        // If a deployment is created referencing this bundle between our SELECT
        // and now, the DB delete will fail due to the FK constraint — which is
        // the safe outcome. We never delete an S3 object that's still referenced.
        await database.delete(schema.AppBundle).where(eq(schema.AppBundle.id, bundle.id))

        // Now safe to delete from S3 — no DB row references this object anymore.
        // S3 DeleteObject on a non-existent key is a no-op (returns 204).
        const s3Key = getBundleS3Key(bundle.appId, bundle.bundleType, bundle.sha256)
        await s3Adapter.deleteFile({ externalId: s3Key, provider: 'S3' }, auth)
      }

      deleted++
      logger.debug('Deleted orphaned bundle', { bundleId: bundle.id, dryRun })
    } catch (error) {
      errors++
      logger.error(`Failed to delete bundle ${bundle.id}:`, error)
    }
  }

  logger.info('Orphaned app bundle cleanup complete', {
    found: orphans.length,
    deleted,
    errors,
    dryRun,
  })

  return { found: orphans.length, deleted, errors }
}
