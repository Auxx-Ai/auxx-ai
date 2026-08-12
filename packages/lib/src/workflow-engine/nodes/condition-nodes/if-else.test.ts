// packages/lib/src/workflow-engine/nodes/condition-nodes/if-else.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { WorkflowNodeType } from '../../core/types'
import { IfElseProcessor } from './if-else'
import type { NodeCase } from './if-else-types'

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

describe('IfElseProcessor', () => {
  let processor: IfElseProcessor
  let contextManager: ExecutionContextManager

  const nodeWithCases = (cases: NodeCase[]): WorkflowNode =>
    ({
      id: 'node-1',
      workflowId: 'workflow-1',
      nodeId: 'gate-1',
      type: WorkflowNodeType.IF_ELSE,
      name: 'Gate',
      data: { id: 'gate-1', type: WorkflowNodeType.IF_ELSE, title: 'Gate', cases },
    }) as unknown as WorkflowNode

  /** Run the node the way the engine does: preprocess, then execute. */
  const run = async (node: WorkflowNode) => {
    const preprocessed = await processor.preprocessNode(node, contextManager)
    return processor.execute(node, contextManager, preprocessed)
  }

  beforeEach(() => {
    processor = new IfElseProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  describe('comparison value resolution', () => {
    it('resolves a {{template}} target instead of comparing against the literal', async () => {
      contextManager.setVariable('shopify.order.email', 'priya@example.com')
      contextManager.setVariable('trigger.message.from.email', 'priya@example.com')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'shopify.order.email',
                comparison_operator: 'is',
                value: '{{trigger.message.from.email}}',
                isConstant: false,
              },
            ],
          },
        ])
      )

      expect(result.outputHandle).toBe('true')
      expect(result.output?.matched).toBe(true)
    })

    it('takes the else branch when the two variables differ', async () => {
      contextManager.setVariable('shopify.order.email', 'someone.else@example.com')
      contextManager.setVariable('trigger.message.from.email', 'priya@example.com')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'shopify.order.email',
                comparison_operator: 'is',
                value: '{{trigger.message.from.email}}',
                isConstant: false,
              },
            ],
          },
        ])
      )

      expect(result.outputHandle).toBe('false')
      expect(result.output?.matched).toBe(false)
    })

    it('resolves a numeric env target so `>` compares numbers, not NaN', async () => {
      contextManager.setVariable('order.totalPrice', 50000)
      contextManager.setVariable('env.HIGH_VALUE_THRESHOLD', 25000)

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'case-high-value',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'order.totalPrice',
                comparison_operator: '>',
                value: '{{env.HIGH_VALUE_THRESHOLD}}',
                isConstant: false,
              },
            ],
          },
        ])
      )

      expect(result.outputHandle).toBe('case-high-value')
    })

    it('resolves a bare variable path when isConstant is false', async () => {
      contextManager.setVariable('a.value', 'match')
      contextManager.setVariable('b.value', 'match')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'a.value',
                comparison_operator: 'is',
                value: 'b.value',
                isConstant: false,
              },
            ],
          },
        ])
      )

      expect(result.output?.matched).toBe(true)
    })

    it('leaves a dotted literal alone when isConstant is not false', async () => {
      contextManager.setVariable('status', 'shipped.today')
      // A variable of the same name exists — a constant target must still win.
      contextManager.setVariable('shipped.today', 'something else')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'status',
                comparison_operator: 'is',
                value: 'shipped.today',
              },
            ],
          },
        ])
      )

      expect(result.output?.matched).toBe(true)
    })

    it('passes array targets through untouched for `in`', async () => {
      contextManager.setVariable('status', 'open')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'status',
                comparison_operator: 'in',
                value: ['open', 'pending'],
              },
            ],
          },
        ])
      )

      expect(result.output?.matched).toBe(true)
    })

    it('records the resolved target in the trace, not the raw template', async () => {
      contextManager.setVariable('order.email', 'priya@example.com')
      contextManager.setVariable('sender.email', 'priya@example.com')

      const result = await run(
        nodeWithCases([
          {
            id: 'c1',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [
              {
                id: 'cond',
                variableId: 'order.email',
                comparison_operator: 'is',
                value: '{{sender.email}}',
                isConstant: false,
              },
            ],
          },
        ])
      )

      expect(result.output?.evaluatedCases[0].conditions[0].target).toBe('priya@example.com')
    })
  })

  describe('multi-case ordering', () => {
    /**
     * The shape the Shopify template relies on: case 1 is "found AND verified",
     * case 2 is reached only when case 1 failed, so it means "found but not
     * verified" without having to express the negation.
     */
    const orderGate = () =>
      nodeWithCases([
        {
          id: 'c1',
          case_id: 'true',
          logical_operator: 'and',
          conditions: [
            { id: 'a', variableId: 'order.name', comparison_operator: 'not empty' },
            {
              id: 'b',
              variableId: 'order.email',
              comparison_operator: 'is',
              value: '{{sender.email}}',
              isConstant: false,
            },
          ],
        },
        {
          id: 'c2',
          case_id: 'case_email_mismatch',
          logical_operator: 'and',
          conditions: [{ id: 'c', variableId: 'order.name', comparison_operator: 'not empty' }],
        },
      ])

    it('routes a verified order to the first case', async () => {
      contextManager.setVariable('order.name', '#1012')
      contextManager.setVariable('order.email', 'priya@example.com')
      contextManager.setVariable('sender.email', 'priya@example.com')

      expect((await run(orderGate())).outputHandle).toBe('true')
    })

    it('routes a found-but-unverified order to the second case', async () => {
      contextManager.setVariable('order.name', '#1012')
      contextManager.setVariable('order.email', 'owner@example.com')
      contextManager.setVariable('sender.email', 'stranger@example.com')

      expect((await run(orderGate())).outputHandle).toBe('case_email_mismatch')
    })

    it('routes a missing order to the else branch', async () => {
      contextManager.setVariable('sender.email', 'priya@example.com')

      expect((await run(orderGate())).outputHandle).toBe('false')
    })

    it('fails closed to mismatch when the sender address is missing', async () => {
      contextManager.setVariable('order.name', '#1012')
      contextManager.setVariable('order.email', 'owner@example.com')
      // no sender.email — interpolation yields '' rather than throwing

      expect((await run(orderGate())).outputHandle).toBe('case_email_mismatch')
    })
  })

  describe('extractRequiredVariables', () => {
    it('declares variables referenced by the comparison value', async () => {
      const node = nodeWithCases([
        {
          id: 'c1',
          case_id: 'true',
          logical_operator: 'and',
          conditions: [
            {
              id: 'cond',
              variableId: 'order.email',
              comparison_operator: 'is',
              value: '{{sender.email}}',
              isConstant: false,
            },
          ],
        },
      ])

      const required = (
        processor as unknown as {
          extractRequiredVariables: (n: WorkflowNode) => string[]
        }
      ).extractRequiredVariables(node)

      expect(required).toContain('order.email')
      expect(required).toContain('sender.email')
    })
  })
})
