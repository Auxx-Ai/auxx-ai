// packages/lib/src/workflow-engine/nodes/trigger-nodes/webhook-endpoint.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Config (`node.data`) for the WEBHOOK_ENDPOINT trigger node, written by
 * `apps/web/src/components/workflow/nodes/core/webhook-trigger/panel.tsx`.
 */
interface WebhookEndpointTriggerData {
  /** Id of the `WebhookEndpoint` whose deliveries fire this workflow. */
  webhookEndpointId?: string
  /** Optional topic scope — blank matches every delivery. */
  topic?: string
  /** Cached endpoint display name (label only, never read at run time). */
  webhookEndpointName?: string
}

/**
 * Platform provenance that `executeAppTriggeredWorkflow` nests under `_meta`
 * alongside the delivered payload (`execution/trigger-app-workflow.ts`).
 */
interface WebhookEndpointTriggerMeta {
  webhook_endpoint_id?: string
  topic?: string
  event_id?: string
  triggered_at?: string
}

/**
 * Processor for the WebhookEndpoint trigger node.
 *
 * Delivery path: `POST /webhooks/endpoint/:id` (apps/api) verifies the delivery,
 * extracts a topic, and enqueues `dispatchWebhookEndpoint`. That job calls
 * `executeAppTriggeredWorkflow`, which stores the run inputs as the
 * `{ event, _meta }` envelope — `event` is the parsed payload verbatim, `_meta`
 * carries `webhook_endpoint_id`, `topic` and `event_id`. Those inputs become
 * `context.triggerData`.
 *
 * So the contract this processor implements is:
 *   - `body`              → `event` (the delivered payload, whatever its shape)
 *   - `topic`             → `_meta.topic`, falling back to the configured topic
 *   - `webhookEndpointId` → `_meta.webhook_endpoint_id`, falling back to config
 *
 * which is exactly what the builder's `webhookTriggerDefinition.outputVariables`
 * advertises. `body` is typed OBJECT there because that is the overwhelmingly
 * common case, but a sender may post an array or a non-JSON string and the
 * payload is passed through rather than coerced.
 */
export class WebhookEndpointTriggerProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.WEBHOOK_ENDPOINT

  /**
   * Trigger nodes start workflows and never depend on upstream variables.
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
    const config = node.data as unknown as WebhookEndpointTriggerData

    // An empty or non-JSON delivery is a legitimate webhook — it must still run the
    // workflow, so (unlike the app-trigger processors) missing trigger data degrades
    // to an empty body rather than throwing at node 1.
    const envelope =
      typeof triggerData === 'object' && triggerData !== null && !Array.isArray(triggerData)
        ? (triggerData as Record<string, unknown>)
        : undefined
    const meta = envelope?._meta as WebhookEndpointTriggerMeta | undefined

    // The payload verbatim. `null` (an empty delivery) normalizes to `{}` so that
    // `{{<node>.body.anything}}` resolves to undefined instead of throwing.
    const body: unknown = envelope?.event ?? {}

    const topic = meta?.topic ?? config?.topic ?? ''
    const webhookEndpointId = meta?.webhook_endpoint_id ?? config?.webhookEndpointId ?? ''

    contextManager.log('INFO', node.name, 'Webhook endpoint trigger activated', {
      webhookEndpointId,
      topic,
      eventId: meta?.event_id,
      bodyType: Array.isArray(body) ? 'array' : typeof body,
    })

    // Advertised output variables (see `webhook-trigger/schema.ts`)
    contextManager.setNodeVariable(node.nodeId, 'topic', topic)
    contextManager.setNodeVariable(node.nodeId, 'webhookEndpointId', webhookEndpointId)
    contextManager.setNodeVariable(node.nodeId, 'body', body)

    const output = { topic, webhookEndpointId, body }

    // Full output object, matching the other trigger processors
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
    const config = node.data as unknown as WebhookEndpointTriggerData

    if (!config?.webhookEndpointId) {
      errors.push('Webhook endpoint is required')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
