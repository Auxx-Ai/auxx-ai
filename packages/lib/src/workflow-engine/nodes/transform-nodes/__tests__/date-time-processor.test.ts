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

      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T00:00:00.000Z')
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

      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T12:00:00.000Z')
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

  /**
   * `timezone` was inert: the panel wrote it, `preprocessNode` validated it into
   * `localizationConfig`, and nothing ever applied it. Every operation now
   * evaluates in that zone, defaulting to UTC.
   */
  describe('timezone', () => {
    /** Round DOWN to the day — the sharpest test of "which wall clock?". */
    const roundNode = (timezone?: string, direction = 'down') =>
      createMockNode({
        operation: 'round',
        inputDate: '2024-01-15T02:30:00.000Z',
        isInputDateConstant: true,
        round: { direction, unit: 'days' },
        ...(timezone ? { timezone } : {}),
      })

    it('defaults to UTC when no timezone is set', async () => {
      const context = createMockContext()
      await run(processor, roundNode(), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T00:00:00.000Z')
    })

    it('rounds on the zone wall clock, not the server clock', async () => {
      // 02:30Z is 21:30 on the PREVIOUS day in New York
      const context = createMockContext()
      await run(processor, roundNode('America/New_York'), context)
      // Same instant as 2024-01-14T05:00:00Z, expressed in the node's zone
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-14T00:00:00.000-05:00')
    })

    it('handles a half-hour offset zone', async () => {
      const context = createMockContext()
      await run(processor, roundNode('Asia/Kolkata'), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T00:00:00.000+05:30')
    })

    it('handles a quarter-hour offset zone', async () => {
      const context = createMockContext()
      await run(processor, roundNode('Asia/Kathmandu', 'up'), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T23:59:59.999+05:45')
    })

    it('rounds to the nearest zone boundary', async () => {
      const context = createMockContext()
      await run(processor, roundNode('America/New_York', 'nearest'), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-14T23:59:59.999-05:00')
    })

    it('rounds across a DST spring-forward day (23 hours long)', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-03-10T12:00:00.000Z',
        isInputDateConstant: true,
        round: { direction: 'up', unit: 'days' },
        timezone: 'America/New_York',
      })
      await run(processor, node, context)
      // The zone's own end-of-day, 03:59:59.999Z the next morning in UTC
      expect(await context.getVariable('datetime-1.result')).toBe('2024-03-10T23:59:59.999-04:00')
    })

    it('renders a format in the zone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'format',
        inputDate: '2024-01-01T15:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'yyyy-mm-dd' },
        timezone: 'Asia/Tokyo',
      })
      await run(processor, node, context)
      // 15:00Z is already the NEXT calendar day in Tokyo
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-02')
    })

    it('renders time-only against a quarter-hour offset', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'format',
        inputDate: '2024-01-15T12:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'time_only' },
        timezone: 'Asia/Kathmandu',
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe('17:45:00')
    })

    it('reads a bare wall-clock input date in the zone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-01-15 09:00',
        isInputDateConstant: true,
        round: { direction: 'down', unit: 'hours' },
        timezone: 'America/New_York',
      })
      await run(processor, node, context)
      // 09:00 wall clock in New York, not 09:00 on the server
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T09:00:00.000-05:00')
    })

    it('does NOT re-shift an input that already carries an offset', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-01-15T09:00:00Z',
        isInputDateConstant: true,
        round: { direction: 'down', unit: 'hours' },
        timezone: 'America/New_York',
      })
      await run(processor, node, context)
      // 09:00Z pins an instant; the zone only changes how it is rendered
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T04:00:00.000-05:00')
    })

    it('rejects an unknown timezone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-01-15T02:30:00.000Z',
        isInputDateConstant: true,
        round: { direction: 'down', unit: 'days' },
        timezone: 'Not/AZone',
      })
      await expect(run(processor, node, context)).rejects.toThrow('Invalid timezone: Not/AZone')
    })
  })

  /**
   * Calendar units follow the zone's wall clock ("same time tomorrow"); exact
   * units are absolute. Across a DST boundary the two give different answers,
   * and both answers are right for their own question.
   */
  describe('add_subtract across DST', () => {
    const shiftNode = (duration: number, unit: string) =>
      createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-03-09T17:00:00.000Z', // 12:00 EST, the day before spring-forward
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration, unit },
        timezone: 'America/New_York',
      })

    it('adds one calendar day as 23 real hours over spring-forward', async () => {
      const context = createMockContext()
      await run(processor, shiftNode(1, 'days'), context)
      const result = (await context.getVariable('datetime-1.result')) as string
      expect(result).toBe('2024-03-10T12:00:00.000-04:00') // same wall clock, one day on
      expect(Date.parse(result) - Date.parse('2024-03-09T17:00:00.000Z')).toBe(23 * 3_600_000)
    })

    it('adds 24 hours as exactly 24 hours over the same boundary', async () => {
      const context = createMockContext()
      await run(processor, shiftNode(24, 'hours'), context)
      const result = (await context.getVariable('datetime-1.result')) as string
      expect(result).toBe('2024-03-10T13:00:00.000-04:00') // an hour later on the wall clock
      expect(Date.parse(result) - Date.parse('2024-03-09T17:00:00.000Z')).toBe(24 * 3_600_000)
    })

    it('adds one calendar day as 25 real hours over fall-back', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-11-02T16:00:00.000Z', // 12:00 EDT
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 1, unit: 'days' },
        timezone: 'America/New_York',
      })
      await run(processor, node, context)
      const result = (await context.getVariable('datetime-1.result')) as string
      expect(result).toBe('2024-11-03T12:00:00.000-05:00')
      expect(Date.parse(result) - Date.parse('2024-11-02T16:00:00.000Z')).toBe(25 * 3_600_000)
    })

    /** `quarters` and `milliseconds` fell through to a `days` default. */
    it('adds a quarter as three months', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-15T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 1, unit: 'quarters' },
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-04-15T00:00:00.000Z')
    })

    it('adds milliseconds as milliseconds', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-15T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 1500, unit: 'milliseconds' },
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T00:00:01.500Z')
    })
  })

  /**
   * The preprocessed path formatted `iso` with a local-offset pattern while the
   * fallback path returned `toISOString()`. Same node, same config, two strings.
   * There is now one execution path, and `iso` means "ISO 8601 in the node's
   * timezone" — which under the UTC default is exactly `toISOString()`.
   */
  describe('iso format', () => {
    const isoNode = (timezone?: string) =>
      createMockNode({
        operation: 'format',
        inputDate: '2024-01-01T00:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'iso' },
        ...(timezone ? { timezone } : {}),
      })

    it('matches toISOString under the UTC default', async () => {
      const context = createMockContext()
      await run(processor, isoNode(), context)
      expect(await context.getVariable('datetime-1.result')).toBe(
        new Date('2024-01-01T00:00:00.000Z').toISOString()
      )
    })

    it('carries the configured zone offset', async () => {
      const context = createMockContext()
      await run(processor, isoNode('America/New_York'), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2023-12-31T19:00:00.000-05:00')
    })

    it('carries a half-hour offset', async () => {
      const context = createMockContext()
      await run(processor, isoNode('Asia/Kolkata'), context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-01T05:30:00.000+05:30')
    })
  })

  /**
   * `outputAsTimestamp` was read by the engine with no writer in the panel, and
   * applied to add/subtract only. It now covers all three date-producing
   * operations, which otherwise share one ISO-string shape.
   */
  describe('outputAsTimestamp', () => {
    const expected = Date.parse('2024-01-15T00:00:00.000Z')

    it('applies to add_subtract', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'add_subtract',
        inputDate: '2024-01-14T00:00:00.000Z',
        isInputDateConstant: true,
        addSubtract: { action: 'add', duration: 1, unit: 'days' },
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(expected)
    })

    it('applies to round', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'round',
        inputDate: '2024-01-15T13:45:00.000Z',
        isInputDateConstant: true,
        round: { direction: 'down', unit: 'days' },
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(expected)
    })

    it('applies to parse_date', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'parse_date',
        inputDate: '2024-01-15',
        isInputDateConstant: true,
        parseDate: { formatType: 'auto' },
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(expected)
    })

    it('does not touch a format result', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'format',
        inputDate: '2024-01-15T00:00:00.000Z',
        isInputDateConstant: true,
        format: { type: 'yyyy-mm-dd' },
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15')
    })
  })

  describe('parse_date in a timezone', () => {
    it('reads a bare wall-clock string as local to the zone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'parse_date',
        inputDate: '2024-01-15T09:00',
        isInputDateConstant: true,
        parseDate: { formatType: 'auto' },
        timezone: 'America/New_York',
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe('2024-01-15T09:00:00.000-05:00')
    })

    it('reads a custom-format string as local to the zone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'parse_date',
        inputDate: '15/01/2024 09:00',
        isInputDateConstant: true,
        parseDate: { formatType: 'custom', customFormat: 'dd/MM/yyyy HH:mm' },
        timezone: 'Asia/Kolkata',
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(
        Date.parse('2024-01-15T03:30:00.000Z')
      )
    })

    it('leaves an epoch value absolute', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'parse_date',
        inputDate: '1705276800',
        isInputDateConstant: true,
        parseDate: { formatType: 'unix' },
        timezone: 'America/New_York',
        outputAsTimestamp: true,
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(1_705_276_800_000)
    })
  })

  describe('time_between', () => {
    it('reads both bare wall-clock endpoints in the zone', async () => {
      const context = createMockContext()
      const node = createMockNode({
        operation: 'time_between',
        inputDate: '2024-01-01 00:00',
        isInputDateConstant: true,
        timeBetween: { endDate: '2024-01-11 00:00', isEndDateConstant: true, unit: 'days' },
        timezone: 'Asia/Kolkata',
      })
      await run(processor, node, context)
      expect(await context.getVariable('datetime-1.result')).toBe(10)
    })
  })
})
