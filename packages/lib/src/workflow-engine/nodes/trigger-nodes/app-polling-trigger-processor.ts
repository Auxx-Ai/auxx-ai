// packages/lib/src/workflow-engine/nodes/trigger-nodes/app-polling-trigger-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { extractUserInputs } from './extract-user-inputs'

/**
 * Processor for extension app polling trigger nodes.
 *
 * Polling triggers are scheduled: the platform periodically invokes the app's
 * poll handler, which returns new events as structured triggerData. The platform
 * then dispatches matching workflows with that data.
 *
 * Execution logic is identical to AppWorkflowTriggerProcessor — only the
 * dispatch mechanism differs (polling vs webhook). Run inputs are the same
 * `{ event, _meta }` envelope from `execution/trigger-app-workflow.ts`; note
 * that a poll which fails before producing an event writes a `_meta`-only run
 * (`jobs/workflow/polling-trigger-job.ts`), so `event` may be absent.
 */
export class AppPollingTriggerProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.APP_POLLING_TRIGGER

  protected extractRequiredVariables(_node: WorkflowNode): string[] {
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const context = contextManager.getContext()
    const triggerData = context.triggerData

    if (!triggerData) {
      throw new Error('No trigger data found in execution context for app polling trigger')
    }

    // Unwrap the `{ event, _meta }` envelope. Only an object event has fields to
    // fan out; an array/string/null delivery is addressable as `event` alone.
    const event = (triggerData as Record<string, unknown>).event
    const eventFields: Record<string, unknown> =
      typeof event === 'object' && event !== null && !Array.isArray(event)
        ? (event as Record<string, unknown>)
        : {}

    contextManager.log('INFO', node.name, 'App polling trigger activated', {
      appId: node.data.appId,
      triggerId: node.data.triggerId,
      installationId: node.data.installationId,
    })

    // Apply trigger filters if configured
    const triggerFilters = node.data.triggerFilters as Record<string, string[]> | undefined
    if (triggerFilters) {
      for (const [field, allowedValues] of Object.entries(triggerFilters)) {
        if (!Array.isArray(allowedValues)) continue

        if (allowedValues.length === 0) {
          contextManager.log('INFO', node.name, 'Trigger filtered out (block-all)', { field })
          return {
            status: NodeRunningStatus.Skipped,
            output: { filtered: true, reason: `No allowed values for field: ${field}` },
          }
        }

        const actualValue = String(eventFields[field] ?? '')
        if (!allowedValues.map(String).includes(actualValue)) {
          contextManager.log('INFO', node.name, 'Trigger filtered out', {
            field,
            actualValue,
            allowedValues,
          })
          return {
            status: NodeRunningStatus.Skipped,
            output: {
              filtered: true,
              reason: `Field "${field}" value "${actualValue}" not in allowed values`,
            },
          }
        }
      }
    }

    // Expose configured trigger inputs (e.g., calendarId, triggerOn) as node variables
    const configuredInputs = extractUserInputs(node.data)
    for (const [key, value] of Object.entries(configuredInputs)) {
      contextManager.setNodeVariable(node.nodeId, key, value)
    }

    // Map each trigger event data field to a node variable
    // Event data takes precedence over configured inputs for same-named fields
    for (const [key, value] of Object.entries(eventFields)) {
      contextManager.setNodeVariable(node.nodeId, key, value)
    }

    // Build clean output: configured inputs + event data
    const output: Record<string, unknown> = { ...configuredInputs, ...eventFields }

    // The raw delivery, under a stable alias — the only way to reach a non-object
    // payload. An app field genuinely named `event` wins, so app data is never shadowed.
    if (event !== undefined && !('event' in output)) {
      output.event = event
      contextManager.setNodeVariable(node.nodeId, 'event', event)
    }

    contextManager.setNodeVariable(node.nodeId, 'output', output)

    return {
      status: NodeRunningStatus.Succeeded,
      output,
      outputHandle: 'source',
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    if (!node.data.appId) {
      errors.push('App ID is required for app polling trigger')
    }
    if (!node.data.triggerId) {
      errors.push('Trigger ID is required for app polling trigger')
    }
    if (!node.data.installationId && !node.data.appId) {
      errors.push('App ID is required to resolve installation for app polling trigger')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
