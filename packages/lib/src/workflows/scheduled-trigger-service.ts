// packages/lib/src/workflows/scheduled-trigger-service.ts

import { getQueue, Queues } from '../jobs/queues'
import { createScopedLogger } from '../logger'
import { WorkflowNodeType, WorkflowTriggerType } from '../workflow-engine/core/types'
import type { WorkflowApp } from './types'

const logger = createScopedLogger('scheduled-trigger-service')

export interface ScheduledTriggerConfig {
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
  timeBetweenTriggers: {
    minutes?: number | string
    hours?: number | string
    days?: number | string
    weeks?: number | string
    isConstant?: boolean
  }
  customCron?: string
  timezone?: string
}

export class ScheduledTriggerService {
  private _scheduledTriggerQueue: ReturnType<typeof getQueue> | null = null

  private get scheduledTriggerQueue() {
    if (!this._scheduledTriggerQueue) {
      this._scheduledTriggerQueue = getQueue(Queues.scheduledTriggerQueue)
    }
    return this._scheduledTriggerQueue
  }

  /**
   * Schedule triggers for a published workflow
   * Only schedules if the workflow is published, enabled, and has scheduled trigger type
   */
  async scheduleWorkflowTriggers(
    workflowApp: WorkflowApp & { publishedWorkflow?: any }
  ): Promise<void> {
    logger.info('Evaluating workflow for scheduling', {
      workflowAppId: workflowApp.id,
      hasPublishedWorkflow: !!workflowApp.publishedWorkflow,
      isEnabled: workflowApp.enabled,
      triggerType: workflowApp.publishedWorkflow?.triggerType,
      shouldSchedule:
        workflowApp.enabled &&
        workflowApp.publishedWorkflow &&
        workflowApp.publishedWorkflow.triggerType === WorkflowTriggerType.SCHEDULED,
    })

    if (!workflowApp.publishedWorkflow) {
      logger.warn('No published workflow found for scheduling', { workflowAppId: workflowApp.id })
      return
    }

    if (!workflowApp.enabled) {
      logger.info('Workflow is disabled, skipping scheduling', {
        workflowAppId: workflowApp.id,
        enabled: workflowApp.enabled,
      })
      return
    }

    // Only schedule if this is a scheduled trigger workflow
    if (workflowApp.publishedWorkflow.triggerType !== WorkflowTriggerType.SCHEDULED) {
      logger.info('Workflow is not a scheduled trigger type, skipping scheduling', {
        workflowAppId: workflowApp.id,
        triggerType: workflowApp.publishedWorkflow.triggerType,
      })
      return
    }

    // Find the scheduled trigger node to get configuration
    const scheduledTriggerNode = this.findScheduledTriggerNode(workflowApp.publishedWorkflow)

    if (!scheduledTriggerNode) {
      logger.error('Scheduled workflow missing scheduled trigger node configuration', {
        workflowAppId: workflowApp.id,
      })
      return
    }

    try {
      const schedulerId = this.getSchedulerId(workflowApp.id)
      const cronPattern = this.convertToCronPattern(scheduledTriggerNode.data.config)

      logger.info('Creating scheduler for scheduled workflow', {
        workflowAppId: workflowApp.id,
        nodeId: scheduledTriggerNode.nodeId,
        schedulerId,
        cronPattern,
        triggerConfig: scheduledTriggerNode.data.config,
      })

      await this.scheduledTriggerQueue.upsertJobScheduler(
        schedulerId,
        { pattern: cronPattern },
        {
          name: 'executeScheduledTrigger',
          data: {
            workflowAppId: workflowApp.id,
            organizationId: workflowApp.organizationId,
            nodeId: scheduledTriggerNode.nodeId,
            triggerConfig: scheduledTriggerNode.data.config,
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        }
      )

      logger.info('Scheduler created successfully', {
        workflowAppId: workflowApp.id,
        nodeId: scheduledTriggerNode.nodeId,
        schedulerId,
      })
    } catch (error) {
      logger.error('Failed to create scheduler for workflow', {
        workflowAppId: workflowApp.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Remove all schedulers for a workflow
   */
  async unscheduleWorkflowTriggers(workflowAppId: string): Promise<void> {
    logger.info('Unscheduling workflow triggers', { workflowAppId })

    try {
      // Find all schedulers for this workflow
      const schedulers = await this.scheduledTriggerQueue.getJobSchedulers()

      const schedulerId = this.getSchedulerId(workflowAppId)
      const targetScheduler = schedulers.find((scheduler) => scheduler.id === schedulerId)

      if (targetScheduler) {
        logger.info('Found scheduler to remove', {
          workflowAppId,
          schedulerId: targetScheduler.id,
        })

        try {
          await this.scheduledTriggerQueue.removeJobScheduler(targetScheduler.id!)
          logger.info('Removed scheduler', { workflowAppId, schedulerId: targetScheduler.id })
        } catch (error) {
          logger.error('Failed to remove scheduler', {
            workflowAppId,
            schedulerId: targetScheduler.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } else {
        logger.info('No scheduler found to remove', {
          workflowAppId,
          expectedSchedulerId: schedulerId,
        })
      }
    } catch (error) {
      logger.error('Failed to unschedule workflow triggers', {
        workflowAppId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Find the scheduled trigger node in workflow graph
   * For scheduled workflows, there should be exactly one scheduled trigger node
   */
  private findScheduledTriggerNode(
    workflow: any
  ): { nodeId: string; data: { config: ScheduledTriggerConfig } } | null {
    if (!workflow.graph?.nodes) {
      logger.warn('No workflow graph nodes found', { workflowId: workflow.id })
      return null
    }

    for (const node of workflow.graph.nodes) {
      // Check if this is a scheduled trigger node
      if (node.data?.type === WorkflowNodeType.SCHEDULED && node.data?.config) {
        // Check if the trigger is enabled
        if (node.data.isEnabled !== false) {
          logger.info('Found scheduled trigger node', {
            workflowId: workflow.id,
            nodeId: node.id,
            config: node.data.config,
          })
          return {
            nodeId: node.id,
            data: { config: node.data.config },
          }
        } else {
          logger.info('Skipping disabled scheduled trigger node', {
            workflowId: workflow.id,
            nodeId: node.id,
          })
        }
      }
    }

    logger.warn('No scheduled trigger node found in scheduled workflow', {
      workflowId: workflow.id,
      totalNodes: workflow.graph.nodes.length,
    })
    return null
  }

  /**
   * Generate unique scheduler ID for workflow
   */
  private getSchedulerId(workflowAppId: string): string {
    return `workflow-${workflowAppId}-scheduled`
  }

  /**
   * Convert trigger config to cron pattern
   */
  private convertToCronPattern(config: ScheduledTriggerConfig): string {
    if (config.triggerInterval === 'custom') {
      if (!config.customCron) {
        throw new Error('Custom cron expression is required when using custom interval')
      }
      return config.customCron
    }

    // Convert interval to cron pattern
    const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
    const isConstant = config.timeBetweenTriggers.isConstant ?? true

    if (!isConstant) {
      throw new Error(
        'Variable-based intervals not supported for scheduling - values must be constants'
      )
    }

    if (typeof intervalValue === 'string') {
      throw new Error(
        'String values not supported for scheduling - values must be numeric constants'
      )
    }

    if (!intervalValue || typeof intervalValue !== 'number' || intervalValue <= 0) {
      throw new Error(`Invalid ${config.triggerInterval} value: ${intervalValue}`)
    }

    return this.intervalToCron(config.triggerInterval, intervalValue)
  }

  /**
   * Convert interval values to cron expressions
   */
  private intervalToCron(interval: string, value: number): string {
    switch (interval) {
      case 'minutes':
        if (value >= 60) {
          throw new Error('Minutes interval must be less than 60')
        }
        return `0 */${value} * * * *`
      case 'hours':
        if (value >= 24) {
          throw new Error('Hours interval must be less than 24')
        }
        return `0 0 */${value} * * *`
      case 'days':
        if (value >= 31) {
          throw new Error('Days interval must be less than 31')
        }
        return `0 0 0 */${value} * *`
      case 'weeks':
        if (value >= 52) {
          throw new Error('Weeks interval must be less than 52')
        }
        // For weeks, use day-of-week scheduling
        return value === 1 ? '0 0 0 * * 0' : `0 0 0 * * */${value * 7}`
      default:
        throw new Error(`Unsupported interval: ${interval}`)
    }
  }
}
