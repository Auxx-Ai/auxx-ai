// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/var-assign-processor.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { VarAssignProcessor } from '../var-assign-processor'

function createMockNode(variables: any[], extra: Record<string, any> = {}): WorkflowNode {
  return {
    id: 'assign-1',
    workflowId: 'test-workflow',
    nodeId: 'assign-1',
    type: WorkflowNodeType.VAR_ASSIGN,
    name: 'Assign Variable',
    description: 'Test node for variable assignment',
    data: { id: 'assign-1', type: 'var-assign', title: 'Assign Variable', variables, ...extra },
    metadata: {},
  }
}

function createMockContext(variables: Record<string, any> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
  Object.entries(variables).forEach(([key, value]) => context.setVariable(key, value))
  return context
}

describe('VarAssignProcessor', () => {
  let processor: VarAssignProcessor

  beforeEach(() => {
    processor = new VarAssignProcessor()
  })

  /**
   * The builder's picker advertises `<nodeId>.<name>` for every assignment
   * (`getVarAssignOutputVariables` → `path: variable.name`).
   */
  describe('advertised output paths', () => {
    it('writes every assignment at <nodeId>.<name>', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'issueCategory', type: 'string', value: 'billing' },
        { id: 'b', name: 'retryCount', type: 'number', value: '3' },
      ])

      const result = await processor.execute(node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(await context.getVariable('assign-1.issueCategory')).toBe('billing')
      expect(await context.getVariable('assign-1.retryCount')).toBe(3)
    })

    it('still writes the bare global name', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'issueCategory', type: 'string', value: 'billing' },
      ])

      await processor.execute(node, context)

      expect(await context.getVariable('issueCategory')).toBe('billing')
    })

    it('still writes the <nodeId>.variables aggregate', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'one', type: 'string', value: 'x' },
        { id: 'b', name: 'two', type: 'string', value: 'y' },
      ])

      await processor.execute(node, context)

      expect(await context.getVariable('assign-1.variables')).toEqual({ one: 'x', two: 'y' })
    })

    it('resolves interpolated values before writing the node path', async () => {
      const context = createMockContext({ 'classifier-013.category': 'refund' })
      const node = createMockNode([
        {
          id: 'a',
          name: 'issueCategory',
          type: 'string',
          value: '{{classifier-013.category}}',
        },
      ])

      await processor.execute(node, context)

      expect(await context.getVariable('assign-1.issueCategory')).toBe('refund')
    })

    it('writes array assignments at the advertised path', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'tags', type: 'string', isArray: true, value: ['one', 'two'] },
      ])

      await processor.execute(node, context)

      expect(await context.getVariable('assign-1.tags')).toEqual(['one', 'two'])
    })

    it('skips assignments with an empty name', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: '', type: 'string', value: 'ignored' },
        { id: 'b', name: 'kept', type: 'string', value: 'yes' },
      ])

      await processor.execute(node, context)

      expect(await context.getVariable('assign-1.kept')).toBe('yes')
      expect(await context.getVariable('assign-1.variables')).toEqual({ kept: 'yes' })
    })
  })

  describe('type coercion', () => {
    it('coerces boolean', async () => {
      const context = createMockContext()
      const node = createMockNode([{ id: 'a', name: 'flag', type: 'boolean', value: 'true' }])
      await processor.execute(node, context)
      expect(await context.getVariable('assign-1.flag')).toBe(true)
    })

    it('coerces object', async () => {
      const context = createMockContext()
      const node = createMockNode([{ id: 'a', name: 'payload', type: 'object', value: '{"a":1}' }])
      await processor.execute(node, context)
      expect(await context.getVariable('assign-1.payload')).toEqual({ a: 1 })
    })

    // `ALLOWED_VAR_TYPES` in the panel offers DATE and DATETIME; `convertToType`
    // had no case for either and returned the raw string.
    it('coerces an ISO string to a Date for the date type', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'due', type: 'date', value: '2024-03-01T00:00:00.000Z' },
      ])
      await processor.execute(node, context)
      const value = await context.getVariable('assign-1.due')
      expect(value).toBeInstanceOf(Date)
      expect((value as Date).toISOString()).toBe('2024-03-01T00:00:00.000Z')
    })

    it('coerces a unix-ms string to a Date for the datetime type', async () => {
      const context = createMockContext()
      const node = createMockNode([
        { id: 'a', name: 'seen', type: 'datetime', value: '1709251200000' },
      ])
      await processor.execute(node, context)
      const value = await context.getVariable('assign-1.seen')
      expect(value).toBeInstanceOf(Date)
      expect((value as Date).getTime()).toBe(1709251200000)
    })

    it('fails an unparseable date unless ignoreTypeError is set', async () => {
      const context = createMockContext()
      const node = createMockNode([{ id: 'a', name: 'due', type: 'date', value: 'not a date' }])
      await expect(processor.execute(node, context)).rejects.toThrow()
    })

    it('falls back to the raw value when ignoreTypeError is set', async () => {
      const context = createMockContext()
      const node = createMockNode([{ id: 'a', name: 'due', type: 'date', value: 'not a date' }], {
        ignoreTypeError: true,
      })
      await processor.execute(node, context)
      expect(await context.getVariable('assign-1.due')).toBe('not a date')
    })
  })
})
