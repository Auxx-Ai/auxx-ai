// packages/lib/src/jobs/import/execute-plan-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import { toRecordId } from '@auxx/types/resource'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import {
  createEventPublisher,
  executePlan,
  getAllJobResolutions,
  markJobCompleted,
  markJobExecuting,
  markJobFailed,
} from '../../import'
import type { ImportMappingProperty, ImportPlan } from '../../import/types'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { invalidateSnapshots } from '../../snapshot'

const logger = createScopedLogger('execute-plan-job')

/** Job payload for executing an import plan */
export interface ExecutePlanJobProps {
  jobId: string
  planId: string
  organizationId: string
  userId: string
}

/**
 * Job handler for executing an import plan.
 * Creates/updates records based on the plan.
 */
export async function executePlanJob(job: Job<ExecutePlanJobProps>): Promise<void> {
  const { jobId, planId, organizationId, userId } = job.data

  logger.info('Starting plan execution', { jobId, planId, organizationId })

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

    // Fetch the plan
    const plan = await db.query.ImportPlan.findFirst({
      where: eq(schema.ImportPlan.id, planId),
    })

    if (!plan) {
      throw new Error(`Import plan not found: ${planId}`)
    }

    // Mark job as executing
    await markJobExecuting(db, jobId)
    await publishEvent({ type: 'job:status', status: 'executing' })

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

    // Create CRUD handler and pre-warm caches
    const crudHandler = new UnifiedCrudHandler(organizationId, userId, db)
    const entityDefinitionId = importJob.importMapping.entityDefinitionId

    // Pre-warm caches once for entire import (avoids N queries for N records)
    await crudHandler.warmCache(entityDefinitionId)
    logger.debug('Cache warmed for import', { entityDefinitionId })

    const createRecord = async (data: {
      standardFields: Record<string, unknown>
      customFields: Record<string, unknown>
    }) => {
      logger.debug('createRecord called', { entityDefinitionId })

      // Merge fields - UnifiedCrudHandler handles field routing internally
      const mergedData: Record<string, unknown> = {
        ...data.standardFields,
        ...data.customFields,
      }

      // Use UnifiedCrudHandler with skipEvents and skipSnapshotInvalidation
      // Snapshot will be invalidated once at the end of the import
      const instance = await crudHandler.create(entityDefinitionId, mergedData, {
        skipEvents: true,
        skipSnapshotInvalidation: true,
      })

      logger.debug('Created record', { id: instance.id, entityDefinitionId })
      return { id: instance.id }
    }

    const updateRecord = async (
      id: string,
      data: {
        standardFields: Record<string, unknown>
        customFields: Record<string, unknown>
      }
    ) => {
      logger.debug('updateRecord called', { id, entityDefinitionId, hasId: !!id })

      if (!id) {
        throw new Error(`updateRecord called with invalid id: ${id}`)
      }

      const mergedData: Record<string, unknown> = {
        ...data.standardFields,
        ...data.customFields,
      }

      const recordId = toRecordId(entityDefinitionId, id)
      logger.debug('Calling crudHandler.update', { recordId, entityDefinitionId, id })

      // Use UnifiedCrudHandler with skipEvents and skipSnapshotInvalidation.
      // `modes` is undefined — every field falls through to 'set' (today's
      // behavior); `options` moved to the fourth positional slot.
      const instance = await crudHandler.update(recordId, mergedData, undefined, {
        skipEvents: true,
        skipSnapshotInvalidation: true,
      })

      logger.debug('Updated record', { recordId, entityDefinitionId })
      return { id: instance.id }
    }

    // Execute the plan
    const planData: ImportPlan = {
      id: plan.id,
      importJobId: plan.importJobId,
      status: plan.status as ImportPlan['status'],
      completedAt: plan.completedAt ?? undefined,
      createdAt: plan.createdAt,
    }

    const result = await executePlan({
      db,
      organizationId,
      userId,
      jobId,
      plan: planData,
      entityDefinitionId: importJob.importMapping.entityDefinitionId,
      mappings,
      resolutions,
      createRecord,
      updateRecord,
      onProgress: async (progress) => {
        const percentage = Math.round((progress.processed / progress.total) * 100)
        await job.updateProgress(percentage)

        await publishEvent({
          type: 'execution:progress',
          strategyId: progress.strategyId,
          strategy: progress.strategy,
          processed: progress.processed,
          total: progress.total,
          succeeded: progress.succeeded,
          failed: progress.failed,
        })
      },
    })

    // Invalidate snapshots ONCE after all records processed
    // This ensures the listFiltered cache is updated with the new records
    await invalidateSnapshots({
      organizationId,
      resourceType: entityDefinitionId,
    })
    logger.debug('Invalidated snapshots after import', { entityDefinitionId })

    // Mark job as completed
    await markJobCompleted(db, jobId, result.statistics)

    await publishEvent({
      type: 'execution:complete',
      statistics: result.statistics,
      durationMs: result.durationMs,
    })

    await publishEvent({ type: 'job:status', status: 'completed' })

    logger.info('Plan execution complete', {
      jobId,
      planId,
      statistics: result.statistics,
      durationMs: result.durationMs,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    logger.error('Plan execution failed', { jobId, planId, error: errorMessage })

    // Mark job as failed
    await markJobFailed(db, jobId, errorMessage)

    await publishEvent({ type: 'error', message: errorMessage })
    await publishEvent({ type: 'job:status', status: 'failed' })

    throw error
  }
}
