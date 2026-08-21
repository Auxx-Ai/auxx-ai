// packages/lib/src/jobs/import/generate-plan-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  createEventPublisher,
  generatePlan,
  getAllJobResolutions,
  getPendingRelationLookups,
  getRawDataAsMap,
  resolveRelationLookups,
  toImportStrategyMode,
  updateResolutionsWithLookupResults,
} from '../../import'
import type { ImportMappingProperty } from '../../import/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('generate-plan-job')

/** Job payload for generating an import plan */
export interface GeneratePlanJobProps {
  jobId: string
  organizationId: string
}

/**
 * Recompute every mapped column's resolved/error counts after relation
 * resolution.
 *
 * Two statements for the whole job rather than two per column. The counts are
 * one grouped aggregate over `ImportValueResolution`, served by
 * `ImportValueResolution_status_idx` (`(importJobPropertyId, status)`), and the
 * writes are one batched UPDATE. The per-column form read every resolution row
 * of every column, `resolvedValues` jsonb included, only to derive two
 * integers: a 40-column file with 3,000 distinct values per column materialized
 * 120k jsonb rows in the worker.
 *
 * `'create'` is a RESOLVED outcome, not an unresolved one, the value has a
 * decision attached ("mint this record at execution"). Counting only `'valid'`
 * under-reports and leaves the wizard showing unresolved values that are in
 * fact fully decided.
 *
 * @param jobId - Import job whose columns are recounted
 */
async function refreshResolutionCounts(jobId: string): Promise<void> {
  const propertyIds = (
    await db
      .select({ id: schema.ImportJobProperty.id })
      .from(schema.ImportJobProperty)
      .where(eq(schema.ImportJobProperty.importJobId, jobId))
  ).map((p) => p.id)

  if (propertyIds.length === 0) return

  const counts = await db
    .select({
      propertyId: schema.ImportValueResolution.importJobPropertyId,
      resolvedCount: sql<number>`cast(count(*) FILTER (WHERE ${schema.ImportValueResolution.status} IN ('valid', 'create')) as integer)`,
      errorCount: sql<number>`cast(count(*) FILTER (WHERE ${schema.ImportValueResolution.status} = 'error') as integer)`,
    })
    .from(schema.ImportValueResolution)
    .where(inArray(schema.ImportValueResolution.importJobPropertyId, propertyIds))
    .groupBy(schema.ImportValueResolution.importJobPropertyId)

  const byProperty = new Map(counts.map((row) => [row.propertyId, row]))

  // A column with no resolutions at all has no row in the aggregate and must
  // still be written back to 0/0, otherwise a count from a previous pass
  // survives the recompute this function exists to perform.
  const now = new Date()
  const tuples = propertyIds.map((id) => {
    const row = byProperty.get(id)
    return sql`(${id}::text, ${Number(row?.resolvedCount ?? 0)}::integer, ${Number(row?.errorCount ?? 0)}::integer)`
  })

  await db.execute(sql`
    UPDATE "ImportJobProperty" AS p
    SET "resolvedCount" = v."resolvedCount",
        "errorCount" = v."errorCount",
        "updatedAt" = ${now}
    FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, "resolvedCount", "errorCount")
    WHERE p.id = v.id
  `)
}

/**
 * Job handler for generating an import plan.
 * Analyzes all rows and creates plan records.
 */
export async function generatePlanJob(ctx: JobContext<GeneratePlanJobProps>): Promise<void> {
  const job = ctx.job
  const { jobId, organizationId } = job.data

  logger.info('Starting plan generation', { jobId, organizationId })

  // Get Redis for event publishing
  const redis = await getPublishingClient()
  if (!redis) {
    throw new Error('Redis publishing client not available')
  }
  const publishEvent = createEventPublisher(redis, jobId)

  try {
    // Fetch the import job
    const importJob = await db.query.ImportJob.findFirst({
      where: eq(schema.ImportJob.id, jobId),
      with: {
        importMapping: {
          with: {
            properties: true,
          },
        },
      },
    })

    if (!importJob) {
      throw new Error(`Import job not found: ${jobId}`)
    }

    // Verify organization
    if (importJob.organizationId !== organizationId) {
      throw new Error('Import job does not belong to organization')
    }

    // Update job status to planning
    await db
      .update(schema.ImportJob)
      .set({ status: 'planning', updatedAt: new Date() })
      .where(eq(schema.ImportJob.id, jobId))

    await publishEvent({ type: 'job:status', status: 'planning' })

    // Phase 1: Resolve pending relation lookups
    const pendingLookups = await getPendingRelationLookups(db, jobId)

    if (pendingLookups.length > 0) {
      logger.info('Resolving pending relation lookups', {
        jobId,
        count: pendingLookups.length,
      })

      // `userId` is what makes `onNoMatch: 'create'` reachable. Auto-creating a
      // `company` from a parts import must assert import authority for `company`
      // INDEPENDENTLY of the parts import's own gate, and that check is
      // fail-closed: with no user to check, every create becomes a row error.
      // Omitting this silently turns the default relation policy into "fail the
      // row", which is the behaviour this work exists to remove.
      const lookupResults = await resolveRelationLookups(db, organizationId, pendingLookups, {
        userId: importJob.createdById ?? undefined,
      })
      await updateResolutionsWithLookupResults(db, lookupResults)

      // Update ImportJobProperty counts after relation resolution
      await refreshResolutionCounts(jobId)

      logger.info('Relation lookups complete', {
        jobId,
        total: pendingLookups.length,
        resolved: lookupResults.filter((r) => r.recordId).length,
        errors: lookupResults.filter((r) => r.error).length,
      })
    }

    // Phase 2: Generate the plan
    // Get raw data
    const rawData = await getRawDataAsMap(db, jobId)

    // Get mappings
    const mappings = importJob.importMapping.properties.map((p) => ({
      id: p.id,
      importMappingId: p.importMappingId,
      sourceColumnIndex: p.sourceColumnIndex,
      sourceColumnName: p.sourceColumnName ?? undefined,
      targetType: p.targetType as 'particle' | 'relation' | 'skip',
      targetFieldKey: p.targetFieldKey,
      customFieldId: p.customFieldId,
      resolutionType: p.resolutionType as ImportMappingProperty['resolutionType'],
      resolutionConfig: p.resolutionConfig ?? undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))

    // Load resolutions from DB
    const resolutions = await getAllJobResolutions(db, jobId)
    logger.debug('Loaded resolutions', { jobId, count: resolutions.size })

    // Generate the plan
    const result = await generatePlan({
      db,
      organizationId,
      jobId,
      entityDefinitionId: importJob.importMapping.entityDefinitionId,
      rawData,
      mappings,
      resolutions,
      // The match key is ORDERED and may be composite; `defaultStrategy` says
      // what to do with matched vs unmatched rows. Both are per-job columns on
      // ImportMapping, see `deriveIdentifierFieldKeys` for how the keys are
      // recomputed from the per-column `identityRole` markers.
      identifierFieldKeys: importJob.importMapping.identifierFieldKeys ?? undefined,
      mode: toImportStrategyMode(importJob.importMapping.defaultStrategy),
      onRowAnalyzed: async (row) => {
        // Publish each analyzed row for real-time preview
        await publishEvent({
          type: 'planning:row',
          rowIndex: row.rowIndex,
          strategy: row.strategy,
          existingRecordId: row.existingRecordId,
          fields: row.fields,
          errors: row.errors,
          warnings: row.warnings,
        })
      },
      onProgress: async (phase, processed, total) => {
        const progress = Math.round((processed / total) * 100)
        await job.updateProgress(progress)

        // Throttle progress updates (every 10 rows or last row)
        if (processed % 10 === 0 || processed === total) {
          await publishEvent({
            type: 'planning:progress',
            phase,
            processed,
            total,
          })
        }
      },
    })

    // Update job status to ready
    await db
      .update(schema.ImportJob)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(schema.ImportJob.id, jobId))

    await publishEvent({
      type: 'planning:complete',
      estimates: result.estimates,
    })

    await publishEvent({ type: 'job:status', status: 'ready' })

    logger.info('Plan generation complete', {
      jobId,
      planId: result.plan.id,
      estimates: result.estimates,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.error('Plan generation failed', { jobId, error: errorMessage })

    // Update job status to failed
    await db
      .update(schema.ImportJob)
      .set({
        status: 'failed',
        ingestionFailureReason: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportJob.id, jobId))

    await publishEvent({ type: 'error', message: errorMessage })
    await publishEvent({ type: 'job:status', status: 'failed' })

    throw error
  }
}
