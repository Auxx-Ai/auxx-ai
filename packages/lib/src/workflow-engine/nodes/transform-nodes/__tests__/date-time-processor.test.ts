// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/date-time-processor.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../../../core/execution-context'
import type { WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'
import { DateTimeProcessor } from '../date-time-processor'

function createMockNode(data: Record<string, any>): WorkflowNode {
  return {
    id: 'datetime-1',
    workflowId: 'test-workflow',
    nodeId: 'datetime-1',
    type: WorkflowNodeType.DATE_TIME,
    name: 'Date Time',
    description: 'Test node for date-time operations',
    data: { id: 'datetime-1', type: 'date-time', title: 'Date Time', ...data },
    metadata: {},
  }
}

function createMockContext(variables: Record<string, any> = {}): ExecutionContextManager {
  const context = new ExecutionContextManager('test-workflow', 'test-run', 'test-org')
  Object.entries(variables).forEach(([key, value]) => context.setVariable(key, value))
  return context
}

/** The engine always preprocesses before executing — mirror that here. */
async function run(processor: DateTimeProcessor, node: WorkflowNode, ctx: ExecutionContextManager) {
  const preprocessed = await processor.preprocessNode(node, ctx)
  return processor.execute(node, ctx, preprocessed)
}

describe('DateTimeProcessor', () => {
  let processor: DateTimeProcessor

  beforeEach(() => {
    processor = new DateTimeProcessor()
  })

  /** Every operation advertises exactly one output: `<nodeId>.result`. */
  describe('advertised output variable', () => {
    it('writes result for add_subtract', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 5, unit: 'days' },
      })

      const result = await run(processor, node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-06T00:00:00.000Z')
    })

    it('writes result for format', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'format',
        inputDate: '2024-01-15T12:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'unix_ms' },
      })

      await run(processor, node, context)

      expect(await context.getVariable('datetime-1.result')).toBe(
        Date.parse('2024-01-15T12:00:00.000Z')
      )
    })

    it('writes result for time_between', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'time_between',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        timeBetween: {
          endDate: '2024-01-11T00:00:00.000Z',
          isEndDateConstant: true,
          unit: 'days',
        },
      })

      await run(processor, node, context)

      expect(await context.getVariable('datetime-1.result')).toBe(10)
    })

    it('writes result for round', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-01-15T13:45:00.000Z',
        isInputDateConstant: true,
        round: { direction: 'down', unit: 'days' },
      })

      await run(processor, node, context)

      expect(await context.getVariable('datetime-1.result')).toBeInstanceOf(Date)
    })

    it('writes result for parse_date', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'parse_date',
        inputDate: '2024-01-15T12:00:00.000Z',
        isInputDateConstant: true,
        parseDate: { formatType: 'iso' },
      })

      await run(processor, node, context)

      const value = await context.getVariable('datetime-1.result')
      expect(value).toBeInstanceOf(Date)
      expect((value as Date).toISOString()).toBe('2024-01-15T12:00:00.000Z')
    })
  })

  /**
   * The panel writes a variable id into `addSubtract.duration`/`unit` and records the
   * mode in `fieldModes`. Preprocessing used to reject the string outright with
   * "Duration must be a positive number", leaving the fieldModes-aware resolver dead.
   */
  describe('add_subtract in variable mode', () => {
    it('resolves a variable duration', async () => {
      const context = createMockContext({ 'config-node.leadDays': 5 })
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 'config-node.leadDays', unit: 'days' },
        fieldModes: { duration: false },
      })

      const result = await run(processor, node, context)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-06T00:00:00.000Z')
    })

    it('resolves an interpolated variable duration', async () => {
      const context = createMockContext({ 'config-node.leadDays': '3' })
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'subtract', duration: '{{config-node.leadDays}}', unit: 'days' },
        fieldModes: { duration: false },
      })

      await run(processor, node, context)

      expect(await context.getVariable('datetime-1.result')).toBe('2023-12-29T00:00:00.000Z')
    })

    it('resolves a variable unit', async () => {
      const context = createMockContext({ 'config-node.unit': 'hours' })
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 2, unit: 'config-node.unit' },
        fieldModes: { unit: false },
      })

      await run(processor, node, context)

      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-01T02:00:00.000Z')
    })

    it('still rejects a constant duration of zero', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 0, unit: 'days' },
      })

      await expect(run(processor, node, context)).rejects.toThrow(
        'Duration must be a positive number'
      )
    })
  })

  /**
   * `locale` used to select only *whether* to localize — every tag rendered in en-US.
   */
  describe('format honours the locale tag', () => {
    const formatNode = (locale?: string) =>
      createMockNode({
        operation: 'format',
        inputDate: '2024-01-15T12:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'long' },
        ...(locale ? { locale } : {}),
      })

    it('defaults to en-US', async () => {
      const context = createMockContext()
      await run(processor, formatNode(), context)
      expect(await context.getVariable('datetime-1.result')).toContain('January')
    })

    it('renders German month names for de-DE', async () => {
      const context = createMockContext()
      await run(processor, formatNode('de-DE'), context)
      const value = (await context.getVariable('datetime-1.result')) as string
      expect(value).toContain('Januar')
      expect(value).not.toContain('January')
    })

    it('renders Portuguese month names for pt-BR', async () => {
      const context = createMockContext()
      await run(processor, formatNode('pt-BR'), context)
      expect(await context.getVariable('datetime-1.result')).toContain('janeiro')
    })

    it('falls back to en-US for an unknown tag', async () => {
      const context = createMockContext()
      await run(processor, formatNode('xx-YY'), context)
      expect(await context.getVariable('datetime-1.result')).toContain('January')
    })
  })
})
