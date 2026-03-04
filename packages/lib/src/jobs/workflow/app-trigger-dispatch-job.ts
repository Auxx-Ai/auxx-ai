// packages/lib/src/jobs/workflow/app-trigger-dispatch-job.ts

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { executeAppTriggeredWorkflow } from '../../workflow-engine/execution/trigger-app-workflow'

const logger = createScopedLogger('app-trigger-dispatch-job')

export type AppTriggerDispatchJobData = {
  appInstallationId: string
  appId: string
  triggerId: string
  connectionId?: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch an app trigger to all matching workflows.
 *
 * 1. Dedup check via Redis NX key (5-minute TTL)
 * 2. Query all published + enabled workflows matching the app trigger
 * 3. Execute each matching workflow with the trigger data
 */
export async function dispatchAppTrigger(job: Job<AppTriggerDispatchJobData>) {
  const {
    appInstallationId,
    appId,
    triggerId,
    connectionId,
    triggerData,
    eventId,
    organizationId,
  } = job.data

  logger.info('Dispatching app trigger', {
    appInstallationId,
    appId,
    triggerId,
    eventId,
    organizationId,
    jobId: job.id,
  })

  // 1. Dedup check
  const dedupKey = `app-trigger-dedup:${appInstallationId}:${triggerId}:${eventId}`

  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate app trigger event, skipping', { dedupKey, eventId })
        return { workflowRunIds: [] }
      }
    } else {
      logger.warn('Redis unavailable, skipping dedup check')
    }
  } catch (error) {
    // If Redis fails, continue without dedup — better to risk a duplicate than miss a trigger
    logger.error('Redis dedup check failed, continuing without dedup', {
      dedupKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 2. Query matching workflows
  // Find all published, enabled workflows that match the specific app + trigger + installation
  try {
    // Build query conditions — match by connectionId when provided
    const conditions = [
      eq(schema.Workflow.organizationId, organizationId),
      eq(schema.Workflow.triggerType, 'app-trigger'),
      eq(schema.Workflow.triggerAppId, appId),
      eq(schema.Workflow.triggerTriggerId, triggerId),
      eq(schema.Workflow.triggerInstallationId, appInstallationId),
      eq(schema.WorkflowApp.enabled, true),
    ]

    if (connectionId) {
      conditions.push(eq(schema.Workflow.triggerConnectionId, connectionId))
    }

    const matchingWorkflows = await db
      .select({
        workflowAppId: schema.WorkflowApp.id,
        workflowId: schema.WorkflowApp.workflowId,
      })
      .from(schema.Workflow)
      .innerJoin(schema.WorkflowApp, eq(schema.WorkflowApp.workflowId, schema.Workflow.id))
      .where(and(...conditions))

    if (matchingWorkflows.length === 0) {
      logger.info('No matching workflows found for app trigger', {
        appId,
        triggerId,
        appInstallationId,
        organizationId,
      })
      return { workflowRunIds: [] }
    }

    logger.info('Found matching workflows for app trigger', {
      count: matchingWorkflows.length,
      appId,
      triggerId,
      appInstallationId,
    })

    // 3. Execute each matching workflow
    const workflowRunIds: string[] = []

    for (const workflow of matchingWorkflows) {
      if (!workflow.workflowId) {
        logger.warn('Workflow has no published version, skipping', {
          workflowAppId: workflow.workflowAppId,
        })
        continue
      }

      const result = await executeAppTriggeredWorkflow({
        workflowAppId: workflow.workflowAppId,
        organizationId,
        triggerData,
        appId,
        triggerId,
        installationId: appInstallationId,
        eventId,
      })

      if (result.isOk()) {
        workflowRunIds.push(result.value.workflowRunId)
      } else {
        logger.error('Failed to execute app-triggered workflow', {
          workflowAppId: workflow.workflowAppId,
          error: result.error,
        })
      }
    }

    logger.info('App trigger dispatch complete', {
      triggeredWorkflows: workflowRunIds.length,
      totalMatching: matchingWorkflows.length,
      appId,
      triggerId,
      eventId,
    })

    return { workflowRunIds }
  } catch (error) {
    logger.error('App trigger dispatch failed', {
      appId,
      triggerId,
      eventId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
