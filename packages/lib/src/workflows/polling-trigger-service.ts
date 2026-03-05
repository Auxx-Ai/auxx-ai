// packages/lib/src/workflows/polling-trigger-service.ts

import { getQueue, Queues } from '../jobs/queues'
import { createScopedLogger } from '../logger'
import { WorkflowTriggerType } from '../workflow-engine/core/types'
import type { WorkflowApp } from './types'

const logger = createScopedLogger('polling-trigger-service')

export class PollingTriggerService {
  private _pollingTriggerQueue: ReturnType<typeof getQueue> | null = null

  private get pollingTriggerQueue() {
    if (!this._pollingTriggerQueue) {
      this._pollingTriggerQueue = getQueue(Queues.appPollingTriggerQueue)
    }
    return this._pollingTriggerQueue
  }

  /**
   * Schedule polling for a published workflow with an app polling trigger.
   * Called when workflow is published or enabled.
   */
  async schedulePollingTrigger(
    workflowApp: WorkflowApp & { publishedWorkflow?: any }
  ): Promise<void> {
    if (!workflowApp.publishedWorkflow) return
    if (!workflowApp.enabled) return
    if (workflowApp.publishedWorkflow.triggerType !== WorkflowTriggerType.APP_POLLING_TRIGGER)
      return

    const triggerNode = this.findPollingTriggerNode(workflowApp.publishedWorkflow)
    if (!triggerNode) {
      logger.warn('Polling trigger workflow missing trigger node', {
        workflowAppId: workflowApp.id,
      })
      return
    }

    // Get polling schedule from trigger node's block config
    const polling = triggerNode.data.config?.polling
    if (!polling) {
      logger.warn('Polling trigger node missing polling config', {
        workflowAppId: workflowApp.id,
      })
      return
    }

    // Enforce minimum interval server-side
    const minInterval = polling.minIntervalMinutes ?? 1
    const requestedInterval = polling.intervalMinutes ?? 5
    const clampedInterval = Math.max(requestedInterval, minInterval, 1)

    const cronPattern = polling.cron ?? `*/${clampedInterval} * * * *`

    const schedulerId = this.getSchedulerId(workflowApp.id)

    try {
      await this.pollingTriggerQueue.upsertJobScheduler(
        schedulerId,
        { pattern: cronPattern },
        {
          name: 'executePollingTrigger',
          data: {
            workflowAppId: workflowApp.id,
            organizationId: workflowApp.organizationId,
            nodeId: triggerNode.nodeId,
            appId: workflowApp.publishedWorkflow.triggerAppId,
            triggerId: workflowApp.publishedWorkflow.triggerTriggerId,
            installationId: workflowApp.publishedWorkflow.triggerInstallationId,
            connectionId: workflowApp.publishedWorkflow.triggerConnectionId,
            triggerConfig: triggerNode.data.config,
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        }
      )

      logger.info('Polling trigger scheduler created', {
        workflowAppId: workflowApp.id,
        schedulerId,
        cronPattern,
      })
    } catch (error) {
      logger.error('Failed to create polling trigger scheduler', {
        workflowAppId: workflowApp.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Remove polling scheduler for a workflow.
   * Called when workflow is disabled or deleted.
   */
  async unschedulePollingTrigger(workflowAppId: string): Promise<void> {
    try {
      const schedulers = await this.pollingTriggerQueue.getJobSchedulers()
      const schedulerId = this.getSchedulerId(workflowAppId)
      const target = schedulers.find((s) => s.id === schedulerId)

      if (target) {
        await this.pollingTriggerQueue.removeJobScheduler(target.id!)
        logger.info('Removed polling trigger scheduler', { workflowAppId, schedulerId })
      }
    } catch (error) {
      logger.error('Failed to unschedule polling trigger', {
        workflowAppId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Find the polling trigger node in the workflow graph.
   * App trigger nodes store node.data.triggerId which equals the workflow-level triggerTriggerId.
   */
  private findPollingTriggerNode(workflow: any) {
    const triggerId = workflow.triggerTriggerId
    if (!triggerId) return null

    return (
      workflow.graph?.nodes?.find(
        (node: any) => node.data?.triggerId === triggerId && node.data?.isEnabled !== false
      ) ?? null
    )
  }

  private getSchedulerId(workflowAppId: string): string {
    return `workflow-${workflowAppId}-polling`
  }
}
