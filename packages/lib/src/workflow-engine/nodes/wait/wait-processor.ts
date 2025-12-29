// packages/lib/src/workflow-engine/nodes/wait/wait-processor.ts

import { BaseNodeProcessor } from '../base-node'
import type {
  WorkflowNode,
  NodeExecutionResult,
  ValidationResult,
  PauseReason,
  PreprocessedNodeData,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import { getQueue, Queues } from '../../../jobs/queues'
import { WAIT_CONSTANTS } from '../../constants'
import { type WaitNodeConfig, DurationUnit, WaitType } from './types'

/**
 * Wait node configuration
 */

export class WaitNodeProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.WAIT

  /**
   * Preprocess Wait node configuration
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as WaitNodeConfig

    // Validate wait configuration
    const waitType = config.waitType

    // Process duration-based wait
    let durationConfig: any = null
    if (waitType === WaitType.DURATION) {
      let waitDuration: number

      if (config.duration !== undefined) {
        // Legacy duration field (in seconds)
        waitDuration = config.duration * 1000
      } else {
        // New format with durationAmount and durationUnit
        const amount = await this.extractValue(
          config.durationAmount,
          config.isDurationConstant ?? true,
          contextManager
        )
        const unit = config.durationUnit || DurationUnit.SECONDS
        waitDuration = this.convertToMilliseconds(Number(amount), unit)
      }

      if (waitDuration <= 0 || waitDuration > WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS) {
        throw new Error('Wait duration must be between 1ms and maximum allowed duration')
      }

      durationConfig = {
        duration: waitDuration / 1000,
        unit: config.durationUnit || DurationUnit.SECONDS,
        resumeAt: new Date(Date.now() + waitDuration),
      }
    }

    // Process timestamp-based wait
    let timestampConfig: any = null
    if (waitType === WaitType.SPECIFIC_TIME) {
      const timeValue = await this.extractValue(
        config.time,
        config.isTimeConstant ?? true,
        contextManager
      )

      const resumeAt = new Date(timeValue)
      if (isNaN(resumeAt.getTime())) {
        throw new Error('Invalid target time format')
      }

      const waitDuration = resumeAt.getTime() - Date.now()
      if (waitDuration < 0) {
        throw new Error('Target time must be in the future')
      }

      timestampConfig = {
        type: 'until',
        targetTime: resumeAt.toISOString(),
        resumeAt,
        duration: waitDuration,
      }
    }

    // Process cancellation configuration
    const cancellationConfig = {
      allowCancellation: true, // Default to allow cancellation
      cancellationCondition: null,
    }

    // Process notification configuration
    const notificationConfig = {
      enabled: false, // Default to no notification
    }

    // Extract variable references
    const usedVariables = new Set<string>()
    if (typeof config.durationAmount === 'string' && config.durationAmount.includes('{{')) {
      this.extractVariableIds(config.durationAmount).forEach((v) => usedVariables.add(v))
    }
    if (typeof config.time === 'string' && config.time.includes('{{')) {
      this.extractVariableIds(config.time).forEach((v) => usedVariables.add(v))
    }

    return {
      inputs: {
        // Wait type configuration
        waitType: waitType as 'duration' | 'until',
        durationConfig,
        timestampConfig,

        // Control configuration
        cancellationConfig,
        notificationConfig,

        // Processing options
        preserveContext: true, // Default to preserve context
        enableMetrics: false,

        // Original configuration for backward compatibility
        originalDuration: config.duration,
        originalDurationAmount: config.durationAmount,
        originalTime: config.time,
        isReadyForWait: true,
      },
      metadata: {
        nodeType: 'wait',
        waitType: waitType,
        hasCondition: false,
        hasCancellation: false,
        hasNotification: false,
        estimatedWaitTime: durationConfig?.duration || timestampConfig?.duration,
        allowsCancellation: true,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  /**
   * Helper method to extract variable IDs from template strings
   */
  // private extractVariableIds(template: string): string[] {
  //   const variables: string[] = []
  //   const regex = /\{\{([^}]+)\}\}/g
  //   let match

  //   while ((match = regex.exec(template)) !== null) {
  //     const variablePath = match[1].trim()
  //     variables.push(variablePath)
  //   }

  //   return variables
  // }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    // Use preprocessed data if available, otherwise fall back to legacy processing
    // if (preprocessedData?.inputs.isReadyForWait) {
    //   return await this.executePreprocessedWait(node, contextManager, preprocessedData)
    // }

    // Legacy execution path for backward compatibility
    const config = node.data as unknown as WaitNodeConfig
    const isDryRun = contextManager.getOptions()?.dryRun
    let originalDurationMs: number | undefined

    try {
      let waitDurationMs: number
      let resumeAt: Date

      // Handle legacy duration field
      if (!config.waitType && config.duration !== undefined) {
        waitDurationMs = config.duration * 1000
        resumeAt = new Date(Date.now() + waitDurationMs)
      } else if (config.waitType === WaitType.DURATION) {
        // Handle duration-based wait
        const amount = await this.extractValue(
          config.durationAmount,
          config.isDurationConstant ?? true,
          contextManager
        )
        const unit = config.durationUnit || DurationUnit.SECONDS
        waitDurationMs = this.convertToMilliseconds(Number(amount), unit)
        resumeAt = new Date(Date.now() + waitDurationMs)
      } else if (config.waitType === WaitType.SPECIFIC_TIME) {
        // Handle specific time wait
        const timeValue = await this.extractValue(
          config.time,
          config.isTimeConstant ?? true,
          contextManager
        )
        resumeAt = new Date(timeValue)
        waitDurationMs = resumeAt.getTime() - Date.now()

        if (waitDurationMs < 0) {
          throw new Error('Cannot wait for a time in the past')
        }
      } else {
        throw new Error('Invalid wait configuration')
      }

      // In dry run mode, cap wait time at 1 second
      if (isDryRun) {
        originalDurationMs = waitDurationMs
        waitDurationMs = Math.min(waitDurationMs, 1000)
        resumeAt = new Date(Date.now() + waitDurationMs)

        contextManager.log(
          'INFO',
          node.name,
          `DryRun: Reducing wait from ${originalDurationMs / 1000}s to ${waitDurationMs / 1000}s`
        )
      }

      // Validate resume time
      this.validateResumeTime(resumeAt, waitDurationMs)

      contextManager.log(
        'INFO',
        node.name,
        config.waitType === WaitType.SPECIFIC_TIME
          ? `Waiting until ${resumeAt.toISOString()}`
          : `Waiting for ${waitDurationMs / 1000} seconds`
      )

      // Decide between short delay (setTimeout) and long delay (queue)
      if (waitDurationMs < WAIT_CONSTANTS.EXECUTION.SHORT_DELAY_THRESHOLD_MS) {
        // Short delay: use setTimeout
        return await this.handleShortDelay(node, waitDurationMs, contextManager, originalDurationMs)
      } else {
        // Long delay: use queue-based approach
        return await this.handleLongDelay(node, resumeAt, waitDurationMs, contextManager)
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.name,
        `Wait node execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }

  private async handleShortDelay(
    node: WorkflowNode,
    waitDurationMs: number,
    contextManager: ExecutionContextManager,
    originalDurationMs?: number
  ): Promise<Partial<NodeExecutionResult>> {
    contextManager.log(
      'DEBUG',
      node.name,
      `Using short delay method (setTimeout) for ${waitDurationMs}ms`
    )

    // For short delays, we pause execution synchronously
    await new Promise((resolve) => setTimeout(resolve, waitDurationMs))

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        wait_duration_ms: waitDurationMs,
        wait_method: 'short_delay',
        dryRun: contextManager.getOptions()?.dryRun || false,
        ...(originalDurationMs !== undefined && { original_duration_ms: originalDurationMs }),
      },
      outputHandle: 'source', // Continue after delay
    }
  }

  private async handleLongDelay(
    node: WorkflowNode,
    resumeAt: Date,
    waitDurationMs: number,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    contextManager.log(
      'DEBUG',
      node.name,
      `Using long delay method (queue) for ${waitDurationMs}ms`
    )

    // Get the main workflow run ID from options (not the branch execution ID)
    const workflowRunId =
      contextManager.getOptions()?.workflowRunId || contextManager.getContext().executionId

    // Schedule resume job
    await this.scheduleResume(workflowRunId, node.nodeId, resumeAt)

    // Create pause reason
    const pauseReason: PauseReason = {
      type: 'wait',
      nodeId: node.nodeId,
      message: `Waiting until ${resumeAt.toISOString()}`,
      metadata: { resumeAt: resumeAt.toISOString(), waitDurationMs, waitMethod: 'queue_delay' },
    }

    // Return paused status - engine will handle the pause
    return {
      status: NodeRunningStatus.Paused,
      pauseReason,
      output: {
        paused_at: new Date().toISOString(),
        resume_at: resumeAt.toISOString(),
        wait_duration_ms: waitDurationMs,
        wait_method: 'queue_delay',
        dryRun: contextManager.getOptions()?.dryRun || false,
      },
      outputHandle: 'source', // Continue after wait completes
    }
  }

  private async scheduleResume(
    workflowRunId: string,
    nodeId: string,
    resumeAt: Date
  ): Promise<void> {
    const delay = resumeAt.getTime() - Date.now()
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)

    await workflowDelayQueue.add(
      'resumeWorkflowJob',
      { workflowRunId, resumeFromNodeId: nodeId },
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )
  }

  private validateResumeTime(resumeAt: Date, waitDurationMs: number): void {
    // Check minimum wait time (1 second)
    if (waitDurationMs < 1000) {
      throw new Error('Wait duration must be at least 1 second')
    }

    // Check maximum wait time (1 year)
    if (waitDurationMs > WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS) {
      throw new Error(
        `Wait duration cannot exceed ${WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS / 1000} seconds`
      )
    }
  }

  /**
   * Extract variables from wait configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as WaitNodeConfig
    const variables = new Set<string>()

    // Extract from durationAmount if it's a variable (not a constant)
    if (
      config.durationAmount &&
      typeof config.durationAmount === 'string' &&
      !config.isDurationConstant
    ) {
      this.extractVariableIds(config.durationAmount).forEach((v) => variables.add(v))
    }

    // Extract from time if it's a variable (not a constant)
    if (config.time && typeof config.time === 'string' && !config.isTimeConstant) {
      this.extractVariableIds(config.time).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as WaitNodeConfig

    // Handle legacy duration field
    if (!config.waitType && config.duration !== undefined) {
      if (typeof config.duration !== 'number') {
        errors.push('Duration must be a number')
      } else if (config.duration < 1) {
        errors.push('Duration must be at least 1 second')
      } else if (config.duration > WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS / 1000) {
        errors.push(
          `Duration cannot exceed ${WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS / 1000} seconds`
        )
      }
      return { valid: errors.length === 0, errors, warnings }
    }

    // Validate based on wait type
    if (!config.waitType) {
      errors.push('Wait type is required')
    } else if (config.waitType === WaitType.DURATION) {
      if (!config.durationAmount) {
        errors.push('Duration amount is required')
      }
      if (!config.durationUnit) {
        errors.push('Duration unit is required')
      }
    } else if (config.waitType === WaitType.SPECIFIC_TIME) {
      if (!config.time) {
        errors.push('Time is required for specific time wait')
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Extract value from a field that might be a variable reference
   */
  private async extractValue(
    value: any,
    isConstant: boolean,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    // If marked as constant, return the value directly
    if (isConstant || isConstant === undefined) {
      // Default to constant for backward compatibility
      return value
    }

    // If not constant, treat as variable reference
    if (value && typeof value === 'string') {
      // Value is the variable ID
      const varValue = await contextManager.getVariable(value)
      return varValue
    } else if (value && typeof value === 'object' && 'id' in value) {
      // Legacy variable reference format
      const varValue = await contextManager.getVariable(value.path || value.id)
      return varValue
    }

    return value
  }

  /**
   * Convert duration amount and unit to milliseconds
   */
  private convertToMilliseconds(amount: number, unit: DurationUnit): number {
    const multipliers = {
      [DurationUnit.SECONDS]: 1000,
      [DurationUnit.MINUTES]: 60 * 1000,
      [DurationUnit.HOURS]: 60 * 60 * 1000,
      [DurationUnit.DAYS]: 24 * 60 * 60 * 1000,
    }
    return amount * (multipliers[unit] || 1000)
  }

  /**
   * Execute wait using preprocessed configuration
   */
  private async executePreprocessedWait(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const inputs = preprocessedData.inputs
    const isDryRun = contextManager.getOptions()?.dryRun
    let originalDurationMs: number | undefined

    try {
      let waitDurationMs: number
      let resumeAt: Date

      // Use preprocessed wait configuration
      if (inputs.waitType === 'duration' && inputs.durationConfig) {
        waitDurationMs = inputs.durationConfig.duration
        resumeAt = inputs.durationConfig.resumeAt
      } else if (inputs.waitType === 'until' && inputs.timestampConfig) {
        resumeAt = inputs.timestampConfig.resumeAt
        waitDurationMs = inputs.timestampConfig.duration
      } else {
        throw new Error('Invalid preprocessed wait configuration')
      }

      // In dry run mode, cap wait time at 1 second
      if (isDryRun) {
        originalDurationMs = waitDurationMs
        waitDurationMs = Math.min(waitDurationMs, 1000)
        resumeAt = new Date(Date.now() + waitDurationMs)

        contextManager.log(
          'INFO',
          node.name,
          `DryRun: Reducing wait from ${originalDurationMs / 1000}s to ${waitDurationMs / 1000}s`
        )
      }

      // Validate resume time
      this.validateResumeTime(resumeAt, waitDurationMs)

      contextManager.log(
        'INFO',
        node.name,
        inputs.waitType === 'until'
          ? `Waiting until ${resumeAt.toISOString()}`
          : `Waiting for ${waitDurationMs / 1000} seconds`
      )

      // Decide between short delay (setTimeout) and long delay (queue)
      if (waitDurationMs < WAIT_CONSTANTS.EXECUTION.SHORT_DELAY_THRESHOLD_MS) {
        // Short delay: use setTimeout
        return await this.handlePreprocessedShortDelay(
          node,
          waitDurationMs,
          contextManager,
          originalDurationMs,
          inputs
        )
      } else {
        // Long delay: use queue-based approach
        return await this.handlePreprocessedLongDelay(
          node,
          resumeAt,
          waitDurationMs,
          contextManager,
          inputs
        )
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.name,
        `Preprocessed wait node execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }

  /**
   * Handle short delay for preprocessed wait
   */
  private async handlePreprocessedShortDelay(
    node: WorkflowNode,
    waitDurationMs: number,
    contextManager: ExecutionContextManager,
    originalDurationMs: number | undefined,
    inputs: any
  ): Promise<Partial<NodeExecutionResult>> {
    contextManager.log(
      'DEBUG',
      node.name,
      `Using short delay method (setTimeout) for ${waitDurationMs}ms`
    )

    // For short delays, we pause execution synchronously
    await new Promise((resolve) => setTimeout(resolve, waitDurationMs))

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        wait_duration_ms: waitDurationMs,
        wait_method: 'short_delay',
        waitType: inputs.waitType,
        dryRun: contextManager.getOptions()?.dryRun || false,
        preprocessed: true,
        ...(originalDurationMs !== undefined && { original_duration_ms: originalDurationMs }),
        ...(inputs.enableMetrics && {
          metrics: { actualWaitTime: waitDurationMs, waitMethod: 'setTimeout' },
        }),
      },
      outputHandle: 'source', // Continue after delay
    }
  }

  /**
   * Handle long delay for preprocessed wait
   */
  private async handlePreprocessedLongDelay(
    node: WorkflowNode,
    resumeAt: Date,
    waitDurationMs: number,
    contextManager: ExecutionContextManager,
    inputs: any
  ): Promise<Partial<NodeExecutionResult>> {
    contextManager.log(
      'DEBUG',
      node.name,
      `Using long delay method (queue) for ${waitDurationMs}ms`
    )

    // Get the main workflow run ID from options (not the branch execution ID)
    const workflowRunId =
      contextManager.getOptions()?.workflowRunId || contextManager.getContext().executionId

    // Schedule resume job
    await this.scheduleResume(workflowRunId, node.nodeId, resumeAt)

    // Create pause reason with preprocessed information
    const pauseReason: PauseReason = {
      type: 'wait',
      nodeId: node.nodeId,
      message: `Waiting until ${resumeAt.toISOString()}`,
      metadata: {
        resumeAt: resumeAt.toISOString(),
        waitDurationMs,
        waitMethod: 'queue_delay',
        waitType: inputs.waitType,
        preprocessed: true,
        ...(inputs.cancellationConfig.allowCancellation && { allowsCancellation: true }),
      },
    }

    // Return paused status - engine will handle the pause
    return {
      status: NodeRunningStatus.Paused,
      pauseReason,
      output: {
        paused_at: new Date().toISOString(),
        resume_at: resumeAt.toISOString(),
        wait_duration_ms: waitDurationMs,
        wait_method: 'queue_delay',
        waitType: inputs.waitType,
        dryRun: contextManager.getOptions()?.dryRun || false,
        preprocessed: true,
        ...(inputs.enableMetrics && {
          metrics: {
            estimatedWaitTime: waitDurationMs,
            waitMethod: 'bullqueue',
            scheduledAt: new Date().toISOString(),
          },
        }),
      },
      outputHandle: 'source', // Continue after wait completes
    }
  }
}
