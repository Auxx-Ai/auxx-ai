// packages/lib/src/workflow-engine/nodes/trigger-nodes/app-polling-trigger-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Processor for extension app polling trigger nodes.
 *
 * Polling triggers are scheduled: the platform periodically invokes the app's
 * poll handler, which returns new events as structured triggerData. The platform
 * then dispatches matching workflows with that data.
 *
 * Execution logic is identical to AppWorkflowTriggerProcessor — only the
 * dispatch mechanism differs (polling vs webhook).
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

    contextManager.log('INFO', node.name, 'App polling trigger activated', {
      appId: node.data.appId,
      triggerId: node.data.triggerId,
      installationId: node.data.installationId,
    })

    // Apply trigger filters if configured
    const triggerFilters = node.data.triggerFilters as Record<string, string[]> | undefined
    if (triggerFilters && typeof triggerData === 'object' && triggerData !== null) {
      for (const [field, allowedValues] of Object.entries(triggerFilters)) {
        if (!Array.isArray(allowedValues)) continue

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

    // Map each trigger data field to a node variable for downstream access
    if (typeof triggerData === 'object' && triggerData !== null) {
      for (const [key, value] of Object.entries(triggerData)) {
        contextManager.setNodeVariable(node.nodeId, key, value)
      }
    }

    contextManager.setNodeVariable(node.nodeId, 'output', triggerData)

    return {
      status: NodeRunningStatus.Succeeded,
      output: triggerData,
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
