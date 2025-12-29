// packages/lib/src/workflow-engine/nodes/trigger-nodes/scheduled.ts

import { BaseNodeProcessor } from '../base-node'
import type { WorkflowNode, NodeExecutionResult, ValidationResult } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { createScopedLogger } from '../../../logger'

const logger = createScopedLogger('scheduled-trigger-processor')

interface ScheduledTriggerNodeData {
  config: {
    triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
    timeBetweenTriggers: {
      minutes?: number | string
      hours?: number | string
      days?: number | string
      weeks?: number | string
      isConstant?: boolean // true = number, false = variable reference
    }
    customCron?: string
    timezone?: string
  }
  isEnabled?: boolean
}

/**
 * Scheduled trigger node processor
 * This node serves as an entry point for time-based workflow triggers
 */
export class ScheduledTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.SCHEDULED

  /**
   * Extract required variables from node configuration
   * Scheduled triggers may reference variables for dynamic interval values
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const variables: string[] = []
    const data = node.data as unknown as ScheduledTriggerNodeData

    if (!data?.config) return []

    const { config } = data
    const isConstant = config.timeBetweenTriggers.isConstant ?? true

    // If using variable references for interval values
    if (!isConstant && config.triggerInterval !== 'custom') {
      const variableRef = config.timeBetweenTriggers[config.triggerInterval]
      if (typeof variableRef === 'string' && variableRef.trim()) {
        variables.push(variableRef)
      }
    }

    return variables
  }

  async validate(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const data = node.data as unknown as ScheduledTriggerNodeData

    if (!data?.config) {
      errors.push('Trigger configuration is required')
      return { valid: false, errors, warnings }
    }

    const { config } = data

    // Validate interval configuration
    if (config.triggerInterval !== 'custom') {
      const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
      const isConstant = config.timeBetweenTriggers.isConstant ?? true

      if (!intervalValue) {
        errors.push(`${config.triggerInterval} value is required`)
      } else if (isConstant && typeof intervalValue === 'number' && intervalValue <= 0) {
        errors.push(`${config.triggerInterval} value must be greater than 0`)
      } else if (!isConstant && typeof intervalValue === 'string' && intervalValue.trim() === '') {
        errors.push(`${config.triggerInterval} variable reference cannot be empty`)
      }
    }

    // Validate custom cron
    if (config.triggerInterval === 'custom') {
      if (!config.customCron || config.customCron.trim() === '') {
        errors.push('Custom cron expression is required when using custom interval')
      } else {
        // Add cron validation logic here
        if (!this.validateCronExpression(config.customCron)) {
          errors.push('Invalid cron expression format')
        }
      }
    }

    // Validate timezone if provided
    if (config.timezone && !this.isValidTimezone(config.timezone)) {
      errors.push('Invalid timezone identifier')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()
    const data = node.data as unknown as ScheduledTriggerNodeData

    logger.info('Processing scheduled trigger', {
      nodeId: node.nodeId,
      triggerInterval: data.config.triggerInterval,
      isEnabled: data.isEnabled,
    })

    // Check if trigger is disabled
    if (data.isEnabled === false) {
      contextManager.log('INFO', node.nodeId, 'Scheduled trigger is disabled')
      return {
        status: NodeRunningStatus.Skipped,
        output: { skipped: true, reason: 'Trigger disabled' },
        executionTime: Date.now() - startTime,
      }
    }

    // Resolve dynamic interval values if needed
    const resolvedConfig = await this.resolveScheduleConfig(data.config, contextManager)

    // Get trigger context
    const triggerData = (await contextManager.getVariable('sys.triggerData')) || {}
    const scheduledTime = triggerData.scheduledTime || new Date().toISOString()

    contextManager.log('INFO', node.nodeId, 'Scheduled trigger activated', {
      triggerInterval: resolvedConfig.triggerInterval,
      scheduledTime,
    })

    // Set output variables
    const output = {
      triggered_at: scheduledTime,
      trigger_type: 'scheduled',
      schedule_config: resolvedConfig,
      interval_description: this.getScheduleDescription(resolvedConfig),
      ...triggerData,
    }

    // Set node-specific variables
    contextManager.setNodeVariable(node.nodeId, 'triggered_at', scheduledTime)
    contextManager.setNodeVariable(node.nodeId, 'schedule_type', resolvedConfig.triggerInterval)

    if (resolvedConfig.triggerInterval === 'custom') {
      contextManager.setNodeVariable(node.nodeId, 'cron_expression', resolvedConfig.customCron)
    } else {
      const intervalValue = resolvedConfig.timeBetweenTriggers[resolvedConfig.triggerInterval]
      contextManager.setNodeVariable(node.nodeId, 'interval_config', {
        unit: resolvedConfig.triggerInterval,
        value: intervalValue,
      })
    }

    return {
      status: NodeRunningStatus.Succeeded,
      output,
      outputHandle: 'source',
      executionTime: Date.now() - startTime,
      metadata: {
        processor: 'scheduled-trigger',
        resolvedConfig,
      },
    }
  }

  /**
   * Resolve dynamic schedule configuration
   */
  private async resolveScheduleConfig(
    config: ScheduledTriggerNodeData['config'],
    contextManager: ExecutionContextManager
  ): Promise<ScheduledTriggerNodeData['config']> {
    const resolved = { ...config }
    const isConstant = config.timeBetweenTriggers.isConstant ?? true

    // If using variables, resolve them at runtime
    if (!isConstant && config.triggerInterval !== 'custom') {
      const variableRef = config.timeBetweenTriggers[config.triggerInterval] as string
      if (typeof variableRef === 'string' && variableRef.trim()) {
        try {
          const resolvedValue = await contextManager.getVariable(variableRef)
          if (typeof resolvedValue === 'number' && resolvedValue > 0) {
            resolved.timeBetweenTriggers = {
              ...resolved.timeBetweenTriggers,
              [config.triggerInterval]: resolvedValue,
            }
          } else {
            throw new Error(
              `Variable ${variableRef} must contain a positive number, got: ${resolvedValue}`
            )
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          throw new Error(`Failed to resolve interval variable ${variableRef}: ${message}`)
        }
      }
    }

    return resolved
  }

  /**
   * Generate human-readable description
   */
  private getScheduleDescription(config: ScheduledTriggerNodeData['config']): string {
    if (config.triggerInterval === 'custom') {
      return config.customCron ? `Custom: ${config.customCron}` : 'Custom cron expression'
    }

    const value = config.timeBetweenTriggers[config.triggerInterval]
    if (!value) return 'Invalid configuration'

    const unit = config.triggerInterval
    const unitDisplay = value === 1 ? unit.slice(0, -1) : unit

    return `Every ${value} ${unitDisplay}`
  }

  /**
   * Validate cron expression
   */
  private validateCronExpression(cron: string): boolean {
    if (!cron || typeof cron !== 'string') return false

    const cronParts = cron.trim().split(/\s+/)
    return cronParts.length === 5 && cronParts.every((part) => /^[0-9*,\-/A-Z]+$/i.test(part))
  }

  /**
   * Validate timezone
   */
  private isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone })
      return true
    } catch {
      return false
    }
  }
}
