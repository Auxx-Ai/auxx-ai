// packages/lib/src/workflow-engine/nodes/trigger-nodes/app-workflow-trigger-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { extractUserInputs } from './extract-user-inputs'

/**
 * Processor for extension app trigger nodes.
 *
 * App triggers are webhook-driven: a third-party service sends a webhook,
 * the app's webhook handler parses it into structured triggerData, and
 * the platform dispatches matching workflows with that data.
 *
 * This processor reads the pre-populated triggerData from the execution
 * context and maps each field to node output variables for downstream nodes.
 */
export class AppWorkflowTriggerProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.APP_TRIGGER

  /**
   * Trigger nodes don't depend on upstream variables — they start workflows.
   */
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
      throw new Error('No trigger data found in execution context for app trigger')
    }

    contextManager.log('INFO', node.name, 'App trigger activated', {
      appId: node.data.appId,
      triggerId: node.data.triggerId,
      installationId: node.data.installationId,
    })

    // Apply trigger filters if configured (e.g., update type, chat ID, user ID)
    const triggerFilters = node.data.triggerFilters as Record<string, string[]> | undefined
    if (triggerFilters && typeof triggerData === 'object' && triggerData !== null) {
      for (const [field, allowedValues] of Object.entries(triggerFilters)) {
        if (!Array.isArray(allowedValues)) continue

        // Empty array means block-all for this field
        if (allowedValues.length === 0) {
          contextManager.log('INFO', node.name, 'Trigger filtered out (block-all)', { field })
          return {
            status: NodeRunningStatus.Skipped,
            output: { filtered: true, reason: `No allowed values for field: ${field}` },
          }
        }

        const actualValue = String((triggerData as Record<string, unknown>)[field] ?? '')
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
    // so downstream nodes can reference them via {{triggerNodeId.calendarId}}
    const configuredInputs = extractUserInputs(node.data)
    for (const [key, value] of Object.entries(configuredInputs)) {
      contextManager.setNodeVariable(node.nodeId, key, value)
    }

    // Map each trigger event data field to a node variable for downstream access
    // e.g., {{triggerNodeId.orderId}}, {{triggerNodeId.customerEmail}}
    // Event data takes precedence over configured inputs for same-named fields
    if (typeof triggerData === 'object' && triggerData !== null) {
      for (const [key, value] of Object.entries(triggerData)) {
        if (key.startsWith('_')) continue
        contextManager.setNodeVariable(node.nodeId, key, value)
      }
    }

    // Build clean output: configured inputs + event data (without platform metadata)
    const eventOutput =
      typeof triggerData === 'object' && triggerData !== null
        ? Object.fromEntries(Object.entries(triggerData).filter(([k]) => !k.startsWith('_')))
        : triggerData
    const output = { ...configuredInputs, ...eventOutput }
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
      errors.push('App ID is required for app trigger')
    }
    if (!node.data.triggerId) {
      errors.push('Trigger ID is required for app trigger')
    }
    // installationId is now resolved at runtime — only require appId for resolution
    if (!node.data.installationId && !node.data.appId) {
      errors.push('App ID is required to resolve installation for app trigger')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
