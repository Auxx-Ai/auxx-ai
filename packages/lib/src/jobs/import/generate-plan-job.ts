// packages/lib/src/jobs/import/generate-plan-job.ts

import { eq } from 'drizzle-orm'
import { database as db } from '@auxx/database'
import { schema } from '@auxx/database'
import { getPublishingClient } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import {
  generatePlan,
  getRawDataAsMap,
  createEventPublisher,
  getAllJobResolutions,
  getPendingRelationLookups,
  resolveRelationLookups,
  updateResolutionsWithLookupResults,
} from '../../import'
import type { ImportMappingProperty } from '../../import/types'

const logger = createScopedLogger('generate-plan-job')

/** Job payload for generating an import plan */
export interface GeneratePlanJobProps {
  jobId: string
  organizationId: string
}

/**
 * Job handler for generating an import plan.
 * Analyzes all rows and creates plan records.
 */
export async function generatePlanJob(job: Job<GeneratePlanJobProps>): Promise<void> {
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

      const lookupResults = await resolveRelationLookups(db, organizationId, pendingLookups)
      await updateResolutionsWithLookupResults(db, lookupResults)

      // Update ImportJobProperty counts after relation resolution
      const jobProperties = await db.query.ImportJobProperty.findMany({
        where: eq(schema.ImportJobProperty.importJobId, jobId),
      })

      for (const jobProp of jobProperties) {
        const resolutions = await db.query.ImportValueResolution.findMany({
          where: eq(schema.ImportValueResolution.importJobPropertyId, jobProp.id),
        })

        const resolvedCount = resolutions.filter((r) => r.status === 'valid').length
        const errorCount = resolutions.filter((r) => r.status === 'error').length

        await db
          .update(schema.ImportJobProperty)
          .set({
            resolvedCount,
            errorCount,
            updatedAt: new Date(),
          })
          .where(eq(schema.ImportJobProperty.id, jobProp.id))
      }

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
      targetTable: importJob.importMapping.targetTable,
      rawData,
      mappings,
      resolutions,
      identifierFieldKey: importJob.importMapping.identifierFieldKey ?? undefined,
      onRowAnalyzed: async (row) => {
        // Publish each analyzed row for real-time preview
        await publishEvent({
          type: 'planning:row',
          rowIndex: row.rowIndex,
          strategy: row.strategy,
          existingRecordId: row.existingRecordId,
          fields: row.fields,
          errors: row.errors,
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
