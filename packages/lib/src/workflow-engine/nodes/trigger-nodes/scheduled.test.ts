// packages/lib/src/workflow-engine/nodes/trigger-nodes/scheduled.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { NodeData, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import {
  SCHEDULE_KINDS,
  SCHEDULE_TRIGGER_INTERVALS,
  ScheduledTriggerProcessor,
  scheduleShapeFor,
} from './scheduled'

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
 * Builds a scheduled-trigger node in the shape
 * `WorkflowGraphBuilder.transformNodes` emits.
 */
const scheduledNode = (data: Partial<NodeData>): WorkflowNode => ({
  id: 'node-1',
  workflowId: 'workflow-1',
  nodeId: 'test',
  type: WorkflowNodeType.SCHEDULED,
  name: 'Test Scheduled Trigger',
  data: {
    id: 'node-1',
    type: WorkflowNodeType.SCHEDULED,
    title: 'Test Scheduled Trigger',
    ...data,
  },
})

describe('ScheduledTriggerProcessor', () => {
  let processor: ScheduledTriggerProcessor
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    processor = new ScheduledTriggerProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  describe('Basic Functionality', () => {
    it('should have correct type', () => {
      expect(processor.type).toBe(WorkflowNodeType.SCHEDULED)
    })
  })

  describe('Validation', () => {
    it('should validate interval configuration', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 2, isConstant: true },
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate custom cron configuration', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: '0 9 * * 1-5',
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle variable references in validation', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'minutes',
          timeBetweenTriggers: {
            minutes: 'interval_var',
            isConstant: false,
          },
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation when config is missing', async () => {
      const node = scheduledNode({})

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Trigger configuration is required')
    })

    it('should fail validation for invalid interval values', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 0, isConstant: true },
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      // hours: 0 is falsy, so !intervalValue is true, triggering "value is required"
      expect(result.errors).toContain('hours value is required')
    })

    it('should fail validation for empty variable references', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'minutes',
          timeBetweenTriggers: {
            minutes: '',
            isConstant: false,
          },
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      // Empty string is falsy, so !intervalValue is true, triggering "value is required"
      expect(result.errors).toContain('minutes value is required')
    })

    it('should fail validation for missing interval value', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'days',
          timeBetweenTriggers: { isConstant: true },
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('days value is required')
    })

    it('should fail validation for empty custom cron', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: '',
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Custom cron expression is required when using custom interval'
      )
    })

    it('should fail validation for invalid cron expression', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: 'invalid cron',
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid cron expression format')
    })

    it('should fail validation for invalid timezone', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 1, isConstant: true },
          timezone: 'Invalid/Timezone',
        },
        isEnabled: true,
      })

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid timezone identifier')
    })
  })

  describe('Execution', () => {
    it('should execute successfully with constant interval', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 2, isConstant: true },
        },
        isEnabled: true,
      })

      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.triggered_at).toBe('2023-01-01T10:00:00Z')
      expect(result.output.trigger_type).toBe('scheduled')
      expect(result.output.schedule_config.triggerInterval).toBe('hours')
      expect(result.output.interval_description).toBe('Every 2 hours')
      expect(result.outputHandle).toBe('source')
    })

    it('should skip execution when disabled', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 2, isConstant: true },
        },
        isEnabled: false,
      })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output.skipped).toBe(true)
      expect(result.output.reason).toBe('Trigger disabled')
    })

    it('should resolve variable values at runtime', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'minutes',
          timeBetweenTriggers: {
            minutes: 'interval_var',
            isConstant: false,
          },
        },
        isEnabled: true,
      })

      contextManager.setVariable('interval_var', 15)
      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.schedule_config.timeBetweenTriggers.minutes).toBe(15)
      expect(result.output.interval_description).toBe('Every 15 minutes')
    })

    it('should handle custom cron expressions', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: '0 9 * * 1-5',
        },
        isEnabled: true,
      })

      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T09:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.schedule_config.customCron).toBe('0 9 * * 1-5')
      expect(result.output.interval_description).toBe('Custom: 0 9 * * 1-5')

      // Check node-specific variables
      expect(await contextManager.getNodeVariable('test', 'cron_expression')).toBe('0 9 * * 1-5')
    })

    it('should throw error for invalid variable resolution', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'minutes',
          timeBetweenTriggers: {
            minutes: 'invalid_var',
            isConstant: false,
          },
        },
        isEnabled: true,
      })

      contextManager.setVariable('invalid_var', 'not_a_number')

      await expect((processor as any).executeNode(node, contextManager)).rejects.toThrow(
        'Variable invalid_var must contain a positive number'
      )
    })

    it('should set node-specific variables for intervals', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'days',
          timeBetweenTriggers: { days: 7, isConstant: true },
        },
        isEnabled: true,
      })

      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      await (processor as any).executeNode(node, contextManager)

      expect(await contextManager.getNodeVariable('test', 'triggered_at')).toBe(
        '2023-01-01T10:00:00Z'
      )
      // The KIND of schedule, not the interval unit — the unit rides on
      // `interval_config.unit` below.
      expect(await contextManager.getNodeVariable('test', 'schedule_type')).toBe('interval')
      expect(await contextManager.getNodeVariable('test', 'interval_config')).toEqual({
        unit: 'days',
        value: 7,
      })
    })
  })

  describe('is_test_run', () => {
    const intervalNode = () =>
      scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 1, isConstant: true },
        },
        isEnabled: true,
      })

    // The scheduler path: `scheduled-trigger-job.ts` calls `createRun({ mode: 'production' })`,
    // which stamps `triggeredFrom = APP_RUN`, so `executeWorkflowAsync` passes
    // `debug: false` and the engine never calls `setDebugMode`.
    it('is false on a scheduler-fired run', async () => {
      const node = intervalNode()
      contextManager.setVariable('sys.triggerData', {
        trigger_type: 'scheduled',
        scheduled_time: '2023-01-01T10:00:00Z',
        node_id: 'test',
      })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.output.is_test_run).toBe(false)
      expect(await contextManager.getNodeVariable('test', 'is_test_run')).toBe(false)
    })

    // The builder path: the run panel posts `mode: 'test'`, which stamps
    // `triggeredFrom = DEBUGGING`, which becomes `executeWorkflow(..., { debug: true })`
    // and then `contextManager.setDebugMode(true)`.
    it('is true on a builder test run', async () => {
      const node = intervalNode()
      contextManager.setDebugMode(true)
      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.output.is_test_run).toBe(true)
      expect(await contextManager.getNodeVariable('test', 'is_test_run')).toBe(true)
    })

    it('is written for custom cron schedules too', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: '0 9 * * 1-5',
        },
        isEnabled: true,
      })
      contextManager.setDebugMode(true)

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.output.is_test_run).toBe(true)
      expect(await contextManager.getNodeVariable('test', 'is_test_run')).toBe(true)
    })

    it('cannot be spoofed by the trigger payload', async () => {
      const node = intervalNode()
      contextManager.setVariable('sys.triggerData', {
        scheduledTime: '2023-01-01T10:00:00Z',
        is_test_run: true,
      })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.output.is_test_run).toBe(false)
      expect(await contextManager.getNodeVariable('test', 'is_test_run')).toBe(false)
    })
  })

  // The `schedule_type` vocabulary is pinned here and nowhere else. `SCHEDULE_KINDS`
  // is the sole definition in the repo (the builder only describes the path; the one
  // other writer, an unreferenced `test-data.ts` fixture that spelled the unit as the
  // kind, is deleted). A fourth spelling — or a new interval unit that nobody mapped
  // to a kind — fails right here.
  describe('schedule_type vocabulary', () => {
    it('has exactly two kinds', () => {
      expect([...SCHEDULE_KINDS]).toEqual(['interval', 'cron'])
    })

    it('maps every panel interval to a declared kind, keeping the unit separate', () => {
      const mapped = SCHEDULE_TRIGGER_INTERVALS.map((interval) => [
        interval,
        scheduleShapeFor(interval),
      ])

      expect(mapped).toEqual([
        ['minutes', { kind: 'interval', unit: 'minutes' }],
        ['hours', { kind: 'interval', unit: 'hours' }],
        ['days', { kind: 'interval', unit: 'days' }],
        ['weeks', { kind: 'interval', unit: 'weeks' }],
        ['custom', { kind: 'cron' }],
      ])
      for (const interval of SCHEDULE_TRIGGER_INTERVALS) {
        expect(SCHEDULE_KINDS).toContain(scheduleShapeFor(interval).kind)
      }
    })

    it("emits 'cron' and the cron_expression path for a custom schedule", async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'custom',
          timeBetweenTriggers: {},
          customCron: '0 9 * * 1-5',
        },
        isEnabled: true,
      })

      await (processor as any).executeNode(node, contextManager)

      expect(await contextManager.getNodeVariable('test', 'schedule_type')).toBe('cron')
      expect(await contextManager.getNodeVariable('test', 'cron_expression')).toBe('0 9 * * 1-5')
      expect(await contextManager.getNodeVariable('test', 'interval_config')).toBeUndefined()
    })

    it("emits 'interval' and carries the unit on interval_config, not schedule_type", async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'weeks',
          timeBetweenTriggers: { weeks: 2, isConstant: true },
        },
        isEnabled: true,
      })

      await (processor as any).executeNode(node, contextManager)

      expect(await contextManager.getNodeVariable('test', 'schedule_type')).toBe('interval')
      expect(await contextManager.getNodeVariable('test', 'interval_config')).toEqual({
        unit: 'weeks',
        value: 2,
      })
      expect(await contextManager.getNodeVariable('test', 'cron_expression')).toBeUndefined()
    })
  })

  describe('triggered_at sourcing', () => {
    // `scheduled-trigger-job.ts` puts the instant in `inputs.scheduled_time`; only
    // that snake_case key ever reaches `sys.triggerData` on a real scheduled fire.
    it("reads the scheduler's snake_case scheduled_time", async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 1, isConstant: true },
        },
        isEnabled: true,
      })
      contextManager.setVariable('sys.triggerData', {
        trigger_type: 'scheduled',
        scheduled_time: '2023-06-01T08:30:00Z',
      })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.output.triggered_at).toBe('2023-06-01T08:30:00Z')
      expect(await contextManager.getNodeVariable('test', 'triggered_at')).toBe(
        '2023-06-01T08:30:00Z'
      )
    })

    it('falls back to now when the payload carries no scheduled instant', async () => {
      const node = scheduledNode({
        config: {
          triggerInterval: 'hours',
          timeBetweenTriggers: { hours: 1, isConstant: true },
        },
        isEnabled: true,
      })

      const before = Date.now()
      const result = await (processor as any).executeNode(node, contextManager)

      expect(Date.parse(result.output.triggered_at)).toBeGreaterThanOrEqual(before)
    })
  })

  describe('Helper Methods', () => {
    it('should validate valid cron expressions', () => {
      const processor = new ScheduledTriggerProcessor()

      expect((processor as any).validateCronExpression('0 9 * * 1-5')).toBe(true)
      expect((processor as any).validateCronExpression('*/15 * * * *')).toBe(true)
      expect((processor as any).validateCronExpression('0 0 1 * *')).toBe(true)
    })

    it('should reject invalid cron expressions', () => {
      const processor = new ScheduledTriggerProcessor()

      expect((processor as any).validateCronExpression('invalid')).toBe(false)
      expect((processor as any).validateCronExpression('0 9 * *')).toBe(false) // Missing field
      expect((processor as any).validateCronExpression('0 9 * * * *')).toBe(false) // Too many fields
      expect((processor as any).validateCronExpression('')).toBe(false)
      expect((processor as any).validateCronExpression(null)).toBe(false)
    })

    it('should validate valid timezones', () => {
      const processor = new ScheduledTriggerProcessor()

      expect((processor as any).isValidTimezone('America/New_York')).toBe(true)
      expect((processor as any).isValidTimezone('Europe/London')).toBe(true)
      expect((processor as any).isValidTimezone('UTC')).toBe(true)
    })

    it('should reject invalid timezones', () => {
      const processor = new ScheduledTriggerProcessor()

      expect((processor as any).isValidTimezone('Invalid/Timezone')).toBe(false)
      expect((processor as any).isValidTimezone('Not/A/Timezone')).toBe(false)
    })

    it('should generate correct schedule descriptions', () => {
      const processor = new ScheduledTriggerProcessor()

      const config1 = {
        triggerInterval: 'hours' as const,
        timeBetweenTriggers: { hours: 2 },
      }
      expect((processor as any).getScheduleDescription(config1)).toBe('Every 2 hours')

      const config2 = {
        triggerInterval: 'minutes' as const,
        timeBetweenTriggers: { minutes: 1 },
      }
      expect((processor as any).getScheduleDescription(config2)).toBe('Every 1 minute')

      const config3 = {
        triggerInterval: 'custom' as const,
        timeBetweenTriggers: {},
        customCron: '0 9 * * 1-5',
      }
      expect((processor as any).getScheduleDescription(config3)).toBe('Custom: 0 9 * * 1-5')
    })
  })
})
