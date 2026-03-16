// packages/lib/src/jobs/workflow/app-trigger-dispatch-job.ts

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { getOrgCache } from '../../cache'
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
 * 2. Query all published + enabled workflows matching the app trigger (via cache)
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

  // 2. Query matching workflows via cache
  try {
    const matchingApps = await getOrgCache().from(organizationId, 'workflowApps').byAppTrigger({
      appId,
      triggerId,
      installationId: appInstallationId,
      connectionId,
    })

    if (matchingApps.length === 0) {
      logger.info('No matching workflows found for app trigger', {
        appId,
        triggerId,
        appInstallationId,
        organizationId,
      })
      return { workflowRunIds: [] }
    }

    logger.info('Found matching workflows for app trigger', {
      count: matchingApps.length,
      appId,
      triggerId,
      appInstallationId,
    })

    // 3. Execute each matching workflow
    const workflowRunIds: string[] = []

    for (const app of matchingApps) {
      if (!app.workflowId) {
        logger.warn('Workflow has no published version, skipping', {
          workflowAppId: app.id,
        })
        continue
      }

      const result = await executeAppTriggeredWorkflow({
        workflowAppId: app.id,
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
          workflowAppId: app.id,
          error: result.error,
        })
      }
    }

    logger.info('App trigger dispatch complete', {
      triggeredWorkflows: workflowRunIds.length,
      totalMatching: matchingApps.length,
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
