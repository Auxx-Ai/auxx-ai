// packages/lib/src/workflow-engine/nodes/trigger-nodes/webhook-processor.ts

import { BaseNodeProcessor } from '../base-node'
import type { WorkflowNode, NodeExecutionResult, ValidationResult } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import type { ExecutionContextManager } from '../../core/execution-context'

/**
 * Data interface for webhook node
 */
interface WebhookData {
  method: 'GET' | 'POST'
  bodySchema?: { schema: object; uiSchema?: object }
  authType?: 'bearer' | 'apiKey' | 'hmac' | null
  authConfig?: { secret?: string; headerName?: string }
  responseConfig?: { statusCode: number; body?: string; headers?: Record<string, string> }
}

/**
 * Processor for webhook trigger nodes
 */
export class WebhookProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.WEBHOOK

  /**
   * Extract required variables from node configuration
   * Trigger nodes don't use upstream variables as they start workflows
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Webhook trigger nodes start workflows and don't depend on upstream variables
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const context = contextManager.getContext()

    // Get webhook data from trigger data
    const webhookData = context.triggerData
    if (!webhookData || !webhookData.method) {
      throw new Error('No webhook data found in execution context')
    }

    contextManager.log('INFO', node.name, 'Webhook trigger activated', {
      method: webhookData.method,
      hasQuery: !!webhookData.query && Object.keys(webhookData.query).length > 0,
      hasBody: !!webhookData.body,
    })

    // Set webhook data as variables using the new setNodeVariable method
    contextManager.setNodeVariable(node.nodeId, 'method', webhookData.method)
    contextManager.setNodeVariable(node.nodeId, 'headers', webhookData.headers)
    contextManager.setNodeVariable(node.nodeId, 'query', webhookData.query)

    if (webhookData.body) {
      contextManager.setNodeVariable(node.nodeId, 'body', webhookData.body)
    }

    // Output the webhook data
    const output = {
      method: webhookData.method,
      headers: webhookData.headers,
      query: webhookData.query,
      body: webhookData.body,
    }

    // Also set the full output object for backward compatibility
    contextManager.setNodeVariable(node.nodeId, 'output', output)

    return {
      status: NodeRunningStatus.Succeeded,
      output,
      outputHandle: 'source', // Standard output for trigger nodes
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const data = node.data as unknown as WebhookData

    if (!data.method) {
      errors.push('HTTP method is required')
    }

    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    return { valid: errors.length === 0, errors, warnings }
  }
}
