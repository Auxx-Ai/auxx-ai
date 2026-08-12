// packages/lib/src/workflow-engine/nodes/trigger-nodes/__tests__/webhook-endpoint.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import { NodeProcessorRegistry } from '../../../core/node-processor-registry'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { WebhookEndpointTriggerProcessor } from '../webhook-endpoint'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

/**
 * Builds a webhook-endpoint trigger node in the shape
 * `WorkflowGraphBuilder.transformNodes` emits.
 */
const webhookEndpointNode = (data: Partial<NodeData> = {}): WorkflowNode => ({
  id: 'node-1',
  workflowId: 'workflow-1',
  nodeId: 'trigger_1',
  type: WorkflowNodeType.WEBHOOK_ENDPOINT,
  name: 'Webhook Endpoint',
  data: {
    id: 'node-1',
    type: WorkflowNodeType.WEBHOOK_ENDPOINT,
    title: 'Webhook Endpoint',
    ...data,
  } as NodeData,
})

/**
 * Mirrors the run `inputs` built by `executeAppTriggeredWorkflow`: the delivered
 * payload nested under `event`, plus the `_meta` provenance envelope.
 */
const triggerInputs = (payload: unknown, meta: Record<string, unknown> = {}) => ({
  event: payload,
  _meta: {
    trigger_type: 'webhook-endpoint',
    webhook_endpoint_id: 'wep_123',
    topic: 'order.created',
    event_id: 'evt_abc',
    triggered_at: '2026-08-11T10:00:00.000Z',
    ...meta,
  },
})

describe('WebhookEndpointTriggerProcessor', () => {
  let processor: WebhookEndpointTriggerProcessor
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    processor = new WebhookEndpointTriggerProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  describe('Registration', () => {
    it('declares the webhook-endpoint node type', () => {
      expect(processor.type).toBe(WorkflowNodeType.WEBHOOK_ENDPOINT)
      expect(processor.type).toBe('webhook-endpoint')
    })

    it('is registered and resolvable from the default registry', async () => {
      const registry = new NodeProcessorRegistry()
      await registry.initializeWithDefaults()

      expect(registry.hasProcessor(WorkflowNodeType.WEBHOOK_ENDPOINT)).toBe(true)

      const resolved = await registry.getProcessor(WorkflowNodeType.WEBHOOK_ENDPOINT)
      expect(resolved).toBeInstanceOf(WebhookEndpointTriggerProcessor)
    })
  })

  describe('Validation', () => {
    it('passes when an endpoint is selected', async () => {
      const result = await processor.validate(
        webhookEndpointNode({ webhookEndpointId: 'wep_123', topic: 'order.created' } as never)
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('passes with a blank topic (matches every delivery)', async () => {
      const result = await processor.validate(
        webhookEndpointNode({ webhookEndpointId: 'wep_123', topic: '' } as never)
      )

      expect(result.valid).toBe(true)
    })

    it('fails when no endpoint is selected', async () => {
      const result = await processor.validate(webhookEndpointNode())

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Webhook endpoint is required')
    })
  })

  describe('Execution', () => {
    it('writes every advertised output variable from a representative delivery', async () => {
      const node = webhookEndpointNode({ webhookEndpointId: 'wep_123', topic: '' } as never)
      const payload = {
        id: 5001,
        email: 'buyer@example.com',
        line_items: [{ sku: 'ABC-1', quantity: 2 }],
      }

      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs(payload),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')

      // The three ids `webhookTriggerDefinition.outputVariables` advertises
      expect(await contextManager.getNodeVariable('trigger_1', 'topic')).toBe('order.created')
      expect(await contextManager.getNodeVariable('trigger_1', 'webhookEndpointId')).toBe('wep_123')
      expect(await contextManager.getNodeVariable('trigger_1', 'body')).toEqual(payload)

      // …plus the conventional full-output object
      expect(await contextManager.getNodeVariable('trigger_1', 'output')).toEqual({
        topic: 'order.created',
        webhookEndpointId: 'wep_123',
        body: payload,
      })
    })

    it('keeps `_meta` out of the body', async () => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs({ id: 1 }),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      const body = await contextManager.getNodeVariable('trigger_1', 'body')
      expect(body).toEqual({ id: 1 })
      expect(body).not.toHaveProperty('_meta')
    })

    it('does not mangle a payload field named `event` or `_meta`', async () => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs({ event: 'order.paid', _meta: { sender: 'stripe' } }),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      expect(await contextManager.getNodeVariable('trigger_1', 'body')).toEqual({
        event: 'order.paid',
        _meta: { sender: 'stripe' },
      })
    })

    it('resolves nested paths into the body for downstream nodes', async () => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs({ order: { customer: { email: 'buyer@example.com' } } }),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      expect(await contextManager.getNodeVariable('trigger_1', 'body.order.customer.email')).toBe(
        'buyer@example.com'
      )
    })

    it('falls back to the configured endpoint id and topic when `_meta` is absent', async () => {
      const node = webhookEndpointNode({
        webhookEndpointId: 'wep_configured',
        topic: 'configured.topic',
      } as never)

      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: { event: { id: 7 } },
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(await contextManager.getNodeVariable('trigger_1', 'webhookEndpointId')).toBe(
        'wep_configured'
      )
      expect(await contextManager.getNodeVariable('trigger_1', 'topic')).toBe('configured.topic')
      expect(await contextManager.getNodeVariable('trigger_1', 'body')).toEqual({ id: 7 })
    })

    // These are the shapes the old top-level spread destroyed: an array collapsed
    // to an index-keyed object and a raw string became one property per character.
    it.each([
      ['an array payload', [{ id: 1 }, { id: 2 }]],
      ['a raw non-JSON string payload', 'plain text body'],
      ['a scalar payload', 42],
      ['a boolean payload', false],
    ])('passes through %s verbatim', async (_label, payload) => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs(payload),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      const result = await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.body).toEqual(payload)
      expect(await contextManager.getNodeVariable('trigger_1', 'body')).toEqual(payload)
    })

    it('indexes into an array payload', async () => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: triggerInputs([{ sku: 'ABC-1' }, { sku: 'ABC-2' }]),
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      expect(await contextManager.getNodeVariable('trigger_1', 'body[1].sku')).toBe('ABC-2')
    })
  })

  describe('Malformed / empty payloads', () => {
    it.each([
      ['no trigger data at all', undefined],
      ['a null envelope', null],
      ['an envelope with no `event` key', { _meta: { webhook_endpoint_id: 'wep_123' } }],
      ['an empty-body delivery (`event: null`)', triggerInputs(null)],
      ['a non-envelope scalar', 42],
    ])('succeeds with an empty body given %s', async (_label, data) => {
      const node = webhookEndpointNode({ webhookEndpointId: 'wep_123' } as never)

      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data,
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.body).toEqual({})
      expect(await contextManager.getNodeVariable('trigger_1', 'body')).toEqual({})
      // Endpoint id still resolves — from `_meta` when present, else from config
      expect(await contextManager.getNodeVariable('trigger_1', 'webhookEndpointId')).toBe('wep_123')
    })

    it('does not throw when the node has no config at all', async () => {
      contextManager.initializeWithTrigger({
        type: WorkflowNodeType.WEBHOOK_ENDPOINT,
        data: undefined,
        timestamp: new Date(),
        organizationId: 'org-1',
      } as never)

      const result = await (processor as any).executeNode(webhookEndpointNode(), contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output).toEqual({ topic: '', webhookEndpointId: '', body: {} })
    })
  })
})
