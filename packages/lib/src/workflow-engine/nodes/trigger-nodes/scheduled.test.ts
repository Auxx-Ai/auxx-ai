// packages/lib/src/workflow-engine/nodes/trigger-nodes/scheduled.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScheduledTriggerProcessor } from './scheduled'
import { ExecutionContextManager } from '../../core/execution-context'
import { WorkflowNodeType, NodeRunningStatus } from '../../core/types'
import type { WorkflowNode } from '../../core/types'

// Mock the logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

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
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 2, isConstant: true },
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate custom cron configuration', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'custom',
            timeBetweenTriggers: {},
            customCron: '0 9 * * 1-5',
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle variable references in validation', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'minutes',
            timeBetweenTriggers: {
              minutes: 'interval_var',
              isConstant: false,
            },
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation when config is missing', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {},
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Trigger configuration is required')
    })

    it('should fail validation for invalid interval values', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 0, isConstant: true },
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hours value must be greater than 0')
    })

    it('should fail validation for empty variable references', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'minutes',
            timeBetweenTriggers: {
              minutes: '',
              isConstant: false,
            },
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('minutes variable reference cannot be empty')
    })

    it('should fail validation for missing interval value', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'days',
            timeBetweenTriggers: { isConstant: true },
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('days value is required')
    })

    it('should fail validation for empty custom cron', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'custom',
            timeBetweenTriggers: {},
            customCron: '',
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Custom cron expression is required when using custom interval'
      )
    })

    it('should fail validation for invalid cron expression', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'custom',
            timeBetweenTriggers: {},
            customCron: 'invalid cron',
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid cron expression format')
    })

    it('should fail validation for invalid timezone', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 1, isConstant: true },
            timezone: 'Invalid/Timezone',
          },
          isEnabled: true,
        },
        connections: {},
      }

      const result = await processor.validate(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid timezone identifier')
    })
  })

  describe('Execution', () => {
    it('should execute successfully with constant interval', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 2, isConstant: true },
          },
          isEnabled: true,
        },
        connections: {},
      }

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
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 2, isConstant: true },
          },
          isEnabled: false,
        },
        connections: {},
      }

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output.skipped).toBe(true)
      expect(result.output.reason).toBe('Trigger disabled')
    })

    it('should resolve variable values at runtime', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'minutes',
            timeBetweenTriggers: {
              minutes: 'interval_var',
              isConstant: false,
            },
          },
          isEnabled: true,
        },
        connections: {},
      }

      contextManager.setVariable('interval_var', 15)
      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.schedule_config.timeBetweenTriggers.minutes).toBe(15)
      expect(result.output.interval_description).toBe('Every 15 minutes')
    })

    it('should handle custom cron expressions', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'custom',
            timeBetweenTriggers: {},
            customCron: '0 9 * * 1-5',
          },
          isEnabled: true,
        },
        connections: {},
      }

      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T09:00:00Z' })

      const result = await (processor as any).executeNode(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.schedule_config.customCron).toBe('0 9 * * 1-5')
      expect(result.output.interval_description).toBe('Custom: 0 9 * * 1-5')

      // Check node-specific variables
      expect(contextManager.getNodeVariable('test', 'cron_expression')).toBe('0 9 * * 1-5')
    })

    it('should throw error for invalid variable resolution', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'minutes',
            timeBetweenTriggers: {
              minutes: 'invalid_var',
              isConstant: false,
            },
          },
          isEnabled: true,
        },
        connections: {},
      }

      contextManager.setVariable('invalid_var', 'not_a_number')

      await expect((processor as any).executeNode(node, contextManager)).rejects.toThrow(
        'Variable invalid_var must contain a positive number'
      )
    })

    it('should set node-specific variables for intervals', async () => {
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'workflow-1',
        nodeId: 'test',
        type: WorkflowNodeType.SCHEDULED,
        name: 'Test Scheduled Trigger',
        data: {
          config: {
            triggerInterval: 'days',
            timeBetweenTriggers: { days: 7, isConstant: true },
          },
          isEnabled: true,
        },
        connections: {},
      }

      contextManager.setVariable('sys.triggerData', { scheduledTime: '2023-01-01T10:00:00Z' })

      await (processor as any).executeNode(node, contextManager)

      expect(contextManager.getNodeVariable('test', 'triggered_at')).toBe('2023-01-01T10:00:00Z')
      expect(contextManager.getNodeVariable('test', 'schedule_type')).toBe('days')
      expect(contextManager.getNodeVariable('test', 'interval_config')).toEqual({
        unit: 'days',
        value: 7,
      })
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
