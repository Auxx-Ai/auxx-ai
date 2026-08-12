// packages/lib/src/workflow-engine/nodes/wait/wait-processor.ts

import { database as defaultDb } from '@auxx/database'
import { getQueue, Queues } from '../../../jobs/queues'
import {
  computeAnchorTarget,
  isPastAnchor,
  resolveSubjectAnchorDate,
} from '../../../sequences/anchor'
import { WAIT_CONSTANTS } from '../../constants'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PauseReason,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { snapToDeliveryWindow } from './delivery-window'
import { buildWorkflowResumeJobId } from './resume-job-id'
import { resolveTargetTime } from './target-time'
import { DurationUnit, type WaitAnchorConfig, type WaitNodeConfig, WaitType } from './types'

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

      // Zero-duration waits are valid when a delivery window OR an anchor supplies the real
      // delay (compiled sequence anchor steps always carry duration 0; step-1 immediate waits
      // carry 0 + window — same rule as `validateNodeConfig`).
      const minWaitMs = config.deliveryWindow || config.anchor ? 0 : 1
      if (
        waitDuration < minWaitMs ||
        waitDuration > WAIT_CONSTANTS.EXECUTION.MAX_WAIT_DURATION_MS
      ) {
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

      const resumeAt = resolveTargetTime(timeValue, config.timezone)
      if (Number.isNaN(resumeAt.getTime())) {
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
      // Client-notifications plan §4.2 — an anchor step that resolved to a NULL or
      // already-past target resolves near-instantly instead of snapping into the delivery
      // window; the following sequence-send-email node's own guard decides skip vs send,
      // so this wait must not introduce artificial delay for a step that won't send anyway.
      let skipDeliveryWindowSnap = false

      // Anchored wait (client-notifications plan §4.2) — takes priority over the legacy
      // duration/specific-time config; a compiled anchor step never sets `waitType`.
      if (config.anchor) {
        const anchorOutcome = await this.resolveAnchorWait(node, contextManager, config.anchor)
        resumeAt = anchorOutcome.resumeAt
        waitDurationMs = resumeAt.getTime() - Date.now()
        skipDeliveryWindowSnap = anchorOutcome.skip
        if (anchorOutcome.skip) {
          contextManager.log('INFO', node.name, anchorOutcome.reason)
        }
      } else if (!config.waitType && config.duration !== undefined) {
        // Handle legacy duration field
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
        // The configured timezone is what the builder's picker writes; a bare wall-clock
        // string is read as local to it (see `./target-time.ts`).
        resumeAt = resolveTargetTime(timeValue, config.timezone)
        if (Number.isNaN(resumeAt.getTime())) {
          throw new Error('Invalid target time format')
        }
        waitDurationMs = resumeAt.getTime() - Date.now()

        if (waitDurationMs < 0) {
          throw new Error('Cannot wait for a time in the past')
        }
      } else {
        throw new Error('Invalid wait configuration')
      }

      // Sequences plan §3.3: snap the computed resumeAt forward into the configured
      // delivery window (business hours/days), before the dry-run cap so test runs
      // stay fast regardless of the window.
      if (config.deliveryWindow && !skipDeliveryWindowSnap) {
        resumeAt = snapToDeliveryWindow(resumeAt, config.deliveryWindow)
        waitDurationMs = resumeAt.getTime() - Date.now()
        // A zero-duration wait already inside the window snaps to "now"; clamp to the
        // 1s minimum so validateResumeTime passes and the short-delay path fires.
        if (waitDurationMs < 1000) {
          waitDurationMs = 1000
          resumeAt = new Date(Date.now() + waitDurationMs)
        }
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

    const pausedAt = new Date()
    const resumeAt = new Date(pausedAt.getTime() + waitDurationMs)

    // For short delays, we pause execution synchronously
    await new Promise((resolve) => setTimeout(resolve, waitDurationMs))

    return {
      status: NodeRunningStatus.Succeeded,
      output: this.publishWaitOutputs(node, contextManager, {
        // `paused_at`/`resume_at` are advertised for EVERY wait, not just queued ones —
        // whether a wait lands on the setTimeout or the queue path depends on runtime
        // values (variable durations, delivery-window snapping, dry-run capping), so a
        // conditionally-written variable would resolve to nothing for half the runs.
        paused_at: pausedAt.toISOString(),
        resume_at: resumeAt.toISOString(),
        wait_duration_ms: waitDurationMs,
        wait_method: 'short_delay',
        dryRun: contextManager.getOptions()?.dryRun || false,
        ...(originalDurationMs !== undefined && { original_duration_ms: originalDurationMs }),
      }),
      outputHandle: 'source', // Continue after delay
    }
  }

  /**
   * Mirror the wait node's output onto the variable store so the paths the builder
   * advertises (`<node>.wait_duration_ms`, `.wait_method`, `.paused_at`, `.resume_at`)
   * actually resolve downstream — node `output` alone is never copied into variables.
   *
   * @returns The same output object, for use as the execution result's `output`.
   */
  private publishWaitOutputs<T extends Record<string, unknown>>(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    output: T
  ): T {
    contextManager.setNodeVariables(node.nodeId, output)
    return output
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
      output: this.publishWaitOutputs(node, contextManager, {
        paused_at: new Date().toISOString(),
        resume_at: resumeAt.toISOString(),
        wait_duration_ms: waitDurationMs,
        wait_method: 'queue_delay',
        dryRun: contextManager.getOptions()?.dryRun || false,
      }),
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
      {
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // Deterministic jobId (client-notifications plan §3/§4.2) — lets `stopWorkflowRun`
        // and `reanchorSequenceRuns` cancel/replace this exact job in O(1) instead of
        // scanning the delay queue.
        jobId: buildWorkflowResumeJobId(workflowRunId, nodeId),
      }
    )
  }

  /**
   * Resolve an anchor-mode wait's target (client-notifications plan §4.2). Looks up the
   * paused run's subject via `sys.triggerData.sequenceRunId` (the same lookup key the
   * sequence-send-email node uses), resolves the subject's LIVE anchor date, and computes
   * `target = anchorDate + offsetDays @ timeOfDay`. A NULL anchor, a missing subject/run, or
   * an already-past target all resolve the SAME way — near-instantly, with
   * `skip: true` — because the wait node itself doesn't send anything; the downstream
   * sequence-send-email node's own guard is what actually decides to skip the send (or exit
   * the run, for a genuinely deleted subject) — see `evaluateSubjectGuards`.
   */
  private async resolveAnchorWait(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    anchor: WaitAnchorConfig
  ): Promise<{ resumeAt: Date; skip: boolean; reason: string }> {
    const skipNow = (reason: string) => ({
      resumeAt: new Date(Date.now() + 2000),
      skip: true,
      reason,
    })

    const context = contextManager.getContext()
    const database = context.db ?? defaultDb
    const triggerData = (await contextManager.getVariable('sys.triggerData')) as
      | { sequenceRunId?: string }
      | undefined
    if (!triggerData?.sequenceRunId) {
      return skipNow('Anchored wait has no sys.triggerData.sequenceRunId — skipping the wait')
    }

    const run = await database.query.SequenceRun.findFirst({
      where: (t, { eq: eqOp, and: andOp }) =>
        andOp(
          eqOp(t.id, triggerData.sequenceRunId!),
          eqOp(t.organizationId, context.organizationId)
        ),
      columns: { subjectId: true },
    })
    if (!run?.subjectId) {
      return skipNow('Anchored wait has no subject on its SequenceRun — skipping the wait')
    }

    const { anchorDate } = await resolveSubjectAnchorDate(
      database,
      context.organizationId,
      anchor.subjectRef,
      run.subjectId
    )
    const target = computeAnchorTarget(
      anchorDate,
      { offsetDays: anchor.offsetDays, timeOfDay: anchor.timeOfDay },
      anchor.timezone
    )
    if (!target || isPastAnchor(target)) {
      return skipNow(
        !target
          ? 'NULL anchor date — skipping the wait'
          : 'Anchor target already passed — skipping the wait'
      )
    }

    return { resumeAt: target, skip: false, reason: '' }
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
      // Zero-duration waits are valid when a delivery window OR an anchor config supplies the
      // actual delay (a compiled sequence step-1 wait carries `durationAmount: 0` + one of
      // these — `preprocessNode`'s `minWaitMs` already encodes this same rule; mirrored here
      // so validation doesn't reject what execution already treats as legal, client-
      // notifications plan §4.2/§5 Phase 2). Preserves the original falsy check for every
      // other case (undefined/null/''/NaN, and the variable-reference string/object forms
      // stay truthy and pass as before).
      const isZeroNumber = typeof config.durationAmount === 'number' && config.durationAmount === 0
      const zeroDurationAllowed = Boolean(config.deliveryWindow) || Boolean(config.anchor)
      if (!config.durationAmount && !(isZeroNumber && zeroDurationAllowed)) {
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

      // Sequences plan §3.3: snap resumeAt into the configured delivery window.
      // `preprocessNode`'s `inputs` don't carry `deliveryWindow` through, so read it
      // straight off the node config (same source `executeNode`'s legacy path uses).
      const deliveryWindow = (node.data as unknown as WaitNodeConfig | undefined)?.deliveryWindow
      if (deliveryWindow) {
        resumeAt = snapToDeliveryWindow(resumeAt, deliveryWindow)
        waitDurationMs = resumeAt.getTime() - Date.now()
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

    const pausedAt = new Date()
    const resumeAt = new Date(pausedAt.getTime() + waitDurationMs)

    // For short delays, we pause execution synchronously
    await new Promise((resolve) => setTimeout(resolve, waitDurationMs))

    return {
      status: NodeRunningStatus.Succeeded,
      output: this.publishWaitOutputs(node, contextManager, {
        paused_at: pausedAt.toISOString(),
        resume_at: resumeAt.toISOString(),
        wait_duration_ms: waitDurationMs,
        wait_method: 'short_delay',
        waitType: inputs.waitType,
        dryRun: contextManager.getOptions()?.dryRun || false,
        preprocessed: true,
        ...(originalDurationMs !== undefined && { original_duration_ms: originalDurationMs }),
        ...(inputs.enableMetrics && {
          metrics: { actualWaitTime: waitDurationMs, waitMethod: 'setTimeout' },
        }),
      }),
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
      output: this.publishWaitOutputs(node, contextManager, {
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
      }),
      outputHandle: 'source', // Continue after wait completes
    }
  }
}
