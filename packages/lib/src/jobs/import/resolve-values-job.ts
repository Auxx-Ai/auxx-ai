// packages/lib/src/jobs/import/resolve-values-job.ts

import { eq, and } from 'drizzle-orm'
import { database as db } from '@auxx/database'
import { schema } from '@auxx/database'
import { getPublishingClient } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { processColumnValues, getColumnValues, createEventPublisher, isPendingRelationLookup } from '../../import'
import type { ResolutionConfig, ResolutionType } from '../../import/types'

const logger = createScopedLogger('resolve-values-job')

/** Job payload for resolving import values */
export interface ResolveValuesJobProps {
  jobId: string
  organizationId: string
}

/**
 * Job handler for resolving import values.
 * Processes each mapped column and runs type-specific resolvers.
 */
export async function resolveValuesJob(job: Job<ResolveValuesJobProps>): Promise<void> {
  const { jobId, organizationId } = job.data

  logger.info('Starting value resolution', { jobId })

  const redis = await getPublishingClient()
  if (!redis) {
    throw new Error('Redis publishing client not available')
  }
  const publishEvent = createEventPublisher(redis, jobId)

  try {
    // Fetch job with mapping properties
    const importJob = await db.query.ImportJob.findFirst({
      where: and(eq(schema.ImportJob.id, jobId), eq(schema.ImportJob.organizationId, organizationId)),
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

    // Filter to mapped columns only (not skipped)
    const mappedProperties = importJob.importMapping.properties.filter(
      (p) => p.targetType !== 'skip' && p.targetFieldKey
    )

    const totalColumns = mappedProperties.length
    let columnsProcessed = 0

    logger.info('Processing mapped columns', { jobId, totalColumns })

    // Process each column
    for (const mappingProp of mappedProperties) {
      // Get or create ImportJobProperty
      let jobProp = await db.query.ImportJobProperty.findFirst({
        where: and(
          eq(schema.ImportJobProperty.importJobId, jobId),
          eq(schema.ImportJobProperty.importMappingPropertyId, mappingProp.id)
        ),
      })

      if (!jobProp) {
        const [newJobProp] = await db
          .insert(schema.ImportJobProperty)
          .values({
            importJobId: jobId,
            importMappingPropertyId: mappingProp.id,
            uniqueValueCount: 0,
            resolvedCount: 0,
            errorCount: 0,
            updatedAt: new Date(),
          })
          .returning()
        jobProp = newJobProp!
      }

      // Fetch column values
      const values = await getColumnValues(db, jobId, mappingProp.sourceColumnIndex)

      // Skip empty columns
      if (values.length === 0) {
        columnsProcessed++
        continue
      }

      // Parse resolution config
      let resolutionConfig: ResolutionConfig = {}
      if (mappingProp.resolutionConfig) {
        try {
          resolutionConfig = JSON.parse(mappingProp.resolutionConfig)
        } catch {
          logger.warn('Invalid resolution config JSON', {
            jobId,
            columnIndex: mappingProp.sourceColumnIndex,
          })
        }
      }

      // Process values
      const resolutions = await processColumnValues({
        db,
        jobPropertyId: jobProp.id,
        values,
        resolutionType: mappingProp.resolutionType as ResolutionType,
        config: resolutionConfig,
        onProgress: async (processed, total) => {
          // Throttled progress updates
          if (processed % 100 === 0 || processed === total) {
            await job.updateProgress(
              Math.round(((columnsProcessed + processed / total) / totalColumns) * 100)
            )
          }
        },
      })

      // Count results
      let validCount = 0
      let errorCount = 0
      const pendingLookups: Array<{ hash: string; value: unknown }> = []

      for (const [hash, resolution] of resolutions) {
        if (resolution.isValid) {
          // Check if this is a pending relation lookup
          const resolvedValue = resolution.resolvedValues[0]?.value
          if (isPendingRelationLookup(resolvedValue)) {
            pendingLookups.push({ hash, value: resolvedValue })
          } else {
            validCount++
          }
        } else {
          errorCount++
        }
      }

      // Count pending lookups as valid for now (will be resolved during planning)
      validCount += pendingLookups.length

      // Update ImportJobProperty
      await db
        .update(schema.ImportJobProperty)
        .set({
          uniqueValueCount: resolutions.size,
          resolvedCount: validCount,
          errorCount,
          updatedAt: new Date(),
        })
        .where(eq(schema.ImportJobProperty.id, jobProp.id))

      columnsProcessed++

      // Publish progress
      await publishEvent({
        type: 'resolution:progress',
        columnIndex: mappingProp.sourceColumnIndex,
        columnName: mappingProp.sourceColumnName ?? `Column ${mappingProp.sourceColumnIndex}`,
        resolved: validCount,
        total: resolutions.size,
        errorsFound: errorCount,
      })

      logger.debug('Column processed', {
        jobId,
        columnIndex: mappingProp.sourceColumnIndex,
        uniqueValues: resolutions.size,
        validCount,
        errorCount,
        pendingLookups: pendingLookups.length,
      })
    }

    // Mark job as ready for plan generation
    // Note: Relation lookups will be resolved during plan generation phase
    await db
      .update(schema.ImportJob)
      .set({
        allowPlanGeneration: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportJob.id, jobId))

    await publishEvent({ type: 'job:status', status: 'waiting' })

    logger.info('Value resolution complete', {
      jobId,
      columnsProcessed,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Value resolution failed', { jobId, error: errorMessage })

    await publishEvent({ type: 'error', message: errorMessage })
    throw error
  }
}
