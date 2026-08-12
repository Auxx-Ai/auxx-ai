// packages/lib/src/workflow-engine/nodes/trigger-nodes/__tests__/app-trigger-processors.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { AppPollingTriggerProcessor } from '../app-polling-trigger-processor'
import { AppWorkflowTriggerProcessor } from '../app-workflow-trigger-processor'

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
 * Mirrors the run `inputs` built by `executeAppTriggeredWorkflow`: the delivery
 * nested under `event`, plus the `_meta` provenance envelope.
 */
const triggerInputs = (payload: unknown, meta: Record<string, unknown> = {}) => ({
  event: payload,
  _meta: {
    trigger_type: 'app-trigger',
    app_id: 'app_1',
    trigger_id: 'order_created',
    installation_id: 'inst_1',
    event_id: 'evt_abc',
    triggered_at: '2026-08-11T10:00:00.000Z',
    ...meta,
  },
})

/**
 * The two processors are parallel implementations that differ only in dispatch
 * mechanism, so the envelope contract is asserted against both.
 */
const variants = [
  {
    name: 'AppWorkflowTriggerProcessor',
    make: () => new AppWorkflowTriggerProcessor(),
    nodeType: WorkflowNodeType.APP_TRIGGER,
  },
  {
    name: 'AppPollingTriggerProcessor',
    make: () => new AppPollingTriggerProcessor(),
    nodeType: WorkflowNodeType.APP_POLLING_TRIGGER,
  },
] as const

describe.each(variants)('$name', ({ make, nodeType }) => {
  let processor: ReturnType<typeof make>
  let contextManager: ExecutionContextManager

  const triggerNode = (data: Partial<NodeData> = {}): WorkflowNode => ({
    id: 'node-1',
    workflowId: 'workflow-1',
    nodeId: 'trigger_1',
    type: nodeType,
    name: 'App Trigger',
    data: {
      id: 'node-1',
      type: nodeType,
      title: 'App Trigger',
      appId: 'app_1',
      triggerId: 'order_created',
      installationId: 'inst_1',
      ...data,
    } as NodeData,
  })

  const runWith = async (data: unknown, node: WorkflowNode = triggerNode()) => {
    contextManager.initializeWithTrigger({
      type: nodeType,
      data,
      timestamp: new Date(),
      organizationId: 'org-1',
    } as never)
    return (processor as any).executeNode(node, contextManager)
  }

  beforeEach(() => {
    processor = make()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  it('declares the right node type', () => {
    expect(processor.type).toBe(nodeType)
  })

  describe('Envelope unwrapping', () => {
    it('fans out object event fields to node variables', async () => {
      const result = await runWith(
        triggerInputs({ orderId: 'ord_9', customerEmail: 'buyer@example.com' })
      )

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')
      expect(await contextManager.getNodeVariable('trigger_1', 'orderId')).toBe('ord_9')
      expect(await contextManager.getNodeVariable('trigger_1', 'customerEmail')).toBe(
        'buyer@example.com'
      )
      expect(result.output).toMatchObject({ orderId: 'ord_9', customerEmail: 'buyer@example.com' })
    })

    it('resolves nested paths inside an event field', async () => {
      await runWith(triggerInputs({ order: { customer: { email: 'buyer@example.com' } } }))

      expect(await contextManager.getNodeVariable('trigger_1', 'order.customer.email')).toBe(
        'buyer@example.com'
      )
    })

    it('never exposes `_meta` as a node variable or output field', async () => {
      const result = await runWith(triggerInputs({ orderId: 'ord_9' }))

      expect(result.output).not.toHaveProperty('_meta')
      expect(await contextManager.getNodeVariable('trigger_1', '_meta')).toBeUndefined()
    })

    it('lets event data win over configured inputs of the same name', async () => {
      const node = triggerNode({ calendarId: 'configured' } as never)
      const result = await runWith(triggerInputs({ calendarId: 'from-event' }), node)

      expect(await contextManager.getNodeVariable('trigger_1', 'calendarId')).toBe('from-event')
      expect(result.output.calendarId).toBe('from-event')
    })

    it('still exposes configured inputs the event does not carry', async () => {
      const node = triggerNode({ calendarId: 'cal_1' } as never)
      const result = await runWith(triggerInputs({ orderId: 'ord_9' }), node)

      expect(await contextManager.getNodeVariable('trigger_1', 'calendarId')).toBe('cal_1')
      expect(result.output.calendarId).toBe('cal_1')
    })

    it('preserves event fields whose names start with an underscore', async () => {
      // The old code stripped these along with the platform `_meta`; now that the
      // platform envelope is a sibling of `event`, app data is never filtered.
      const result = await runWith(triggerInputs({ _internalId: 'x1', orderId: 'ord_9' }))

      expect(await contextManager.getNodeVariable('trigger_1', '_internalId')).toBe('x1')
      expect(result.output._internalId).toBe('x1')
    })
  })

  describe('Non-object deliveries', () => {
    it.each([
      ['an array', [{ id: 1 }, { id: 2 }]],
      ['a raw string', 'plain text body'],
      ['a scalar', 42],
    ])('exposes %s verbatim under the `event` alias', async (_label, payload) => {
      const result = await runWith(triggerInputs(payload))

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(await contextManager.getNodeVariable('trigger_1', 'event')).toEqual(payload)
      expect(result.output.event).toEqual(payload)
    })

    it('lets an app field named `event` shadow the alias', async () => {
      const result = await runWith(triggerInputs({ event: 'order.paid', orderId: 'ord_9' }))

      expect(await contextManager.getNodeVariable('trigger_1', 'event')).toBe('order.paid')
      expect(result.output.event).toBe('order.paid')
    })

    it('succeeds on a `_meta`-only run with no event (failed poll)', async () => {
      const result = await runWith({ _meta: { trigger_type: 'app-polling-trigger' } })

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output).not.toHaveProperty('event')
    })

    it('throws when there is no trigger data at all', async () => {
      await expect(runWith(undefined)).rejects.toThrow(/No trigger data found/)
    })
  })

  describe('Trigger filters', () => {
    it('passes when the event field matches an allowed value', async () => {
      const node = triggerNode({ triggerFilters: { status: ['paid', 'refunded'] } } as never)
      const result = await runWith(triggerInputs({ status: 'paid' }), node)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
    })

    it('skips when the event field is not in the allowed values', async () => {
      const node = triggerNode({ triggerFilters: { status: ['paid'] } } as never)
      const result = await runWith(triggerInputs({ status: 'pending' }), node)

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output.filtered).toBe(true)
    })

    it('skips on an empty allow-list (block-all)', async () => {
      const node = triggerNode({ triggerFilters: { status: [] } } as never)
      const result = await runWith(triggerInputs({ status: 'paid' }), node)

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output.reason).toContain('No allowed values')
    })

    it('skips a filtered non-object delivery rather than matching on nothing', async () => {
      // Previously the filter block was skipped entirely for a non-object payload,
      // so a filtered trigger fired anyway. Now the field simply has no value.
      const node = triggerNode({ triggerFilters: { status: ['paid'] } } as never)
      const result = await runWith(triggerInputs('plain text body'), node)

      expect(result.status).toBe(NodeRunningStatus.Skipped)
    })
  })

  describe('Validation', () => {
    it('passes with appId and triggerId', async () => {
      const result = await processor.validate(triggerNode())
      expect(result.valid).toBe(true)
    })

    it('fails without appId', async () => {
      const node = triggerNode()
      node.data.appId = undefined
      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
    })
  })
})
