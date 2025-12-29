// apps/web/src/components/workflow/nodes/core/scheduled-trigger/schema.ts

import { z } from 'zod'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type ScheduledTriggerNodeData } from './types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { ScheduledTriggerPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { type UnifiedVariable, BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'

/**
 * Zod schema for scheduled trigger UI configuration
 */
export const scheduledTriggerUIConfigSchema = z.object({
  triggerInterval: z.enum(['minutes', 'hours', 'days', 'weeks', 'custom']),
  timeBetweenTriggers: z.object({
    minutes: z.union([z.number().min(1), z.string().min(1)]).optional(),
    hours: z.union([z.number().min(1), z.string().min(1)]).optional(),
    days: z.union([z.number().min(1), z.string().min(1)]).optional(),
    weeks: z.union([z.number().min(1), z.string().min(1)]).optional(),
    isConstant: z.boolean().optional(),
  }),
  customCron: z.string().optional(),
  timezone: z.string().optional(),
  startDate: z.string().optional(),
})

/**
 * Zod schema for scheduled trigger node data
 */
export const scheduledTriggerNodeDataSchema = baseNodeDataSchema.extend({
  config: scheduledTriggerUIConfigSchema,
  isEnabled: z.boolean().default(true),
})

/**
 * Create default data for scheduled trigger node
 */
export const createScheduledTriggerDefaultData = (): Partial<ScheduledTriggerNodeData> => ({
  config: {
    triggerInterval: 'hours',
    timeBetweenTriggers: { hours: 1, isConstant: true },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  isEnabled: true,
})

export const scheduledTriggerDefaultData = createScheduledTriggerDefaultData()

/**
 * Validate scheduled trigger node data
 */
export function validateScheduledTriggerData(data: ScheduledTriggerNodeData): ValidationResult {
  try {
    scheduledTriggerNodeDataSchema.parse(data)

    // Additional validation logic
    const errors: { field: string; message: string; type: 'error' | 'warning' }[] = []

    const { config } = data

    // Validate interval configuration
    if (config.triggerInterval !== 'custom') {
      const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
      const isConstant = config.timeBetweenTriggers.isConstant ?? true

      if (!intervalValue) {
        errors.push({
          field: `timeBetweenTriggers.${config.triggerInterval}`,
          message: `${config.triggerInterval} value is required`,
          type: 'error',
        })
      } else if (isConstant && typeof intervalValue === 'number' && intervalValue <= 0) {
        errors.push({
          field: `timeBetweenTriggers.${config.triggerInterval}`,
          message: `${config.triggerInterval} value must be greater than 0`,
          type: 'error',
        })
      } else if (!isConstant && typeof intervalValue === 'string' && intervalValue.trim() === '') {
        errors.push({
          field: `timeBetweenTriggers.${config.triggerInterval}`,
          message: `${config.triggerInterval} variable reference cannot be empty`,
          type: 'error',
        })
      }

      // Warn about very frequent schedules (only for constant numeric values)
      if (
        config.triggerInterval === 'minutes' &&
        isConstant &&
        typeof intervalValue === 'number' &&
        intervalValue < 5
      ) {
        errors.push({
          field: 'timeBetweenTriggers.minutes',
          message: 'Schedules less than 5 minutes may impact performance',
          type: 'warning',
        })
      }

      // Add warning for variable references
      if (!isConstant) {
        errors.push({
          field: `timeBetweenTriggers.${config.triggerInterval}`,
          message:
            'Variable values will be validated at runtime - ensure the variable contains a positive number',
          type: 'warning',
        })
      }
    }

    // Validate custom cron expression
    if (config.triggerInterval === 'custom') {
      if (!config.customCron || config.customCron.trim() === '') {
        errors.push({
          field: 'customCron',
          message: 'Custom cron expression is required when using custom interval',
          type: 'error',
        })
      } else {
        // Basic cron validation (5 fields)
        const cronParts = config.customCron.trim().split(/\s+/)
        if (cronParts.length !== 5) {
          errors.push({
            field: 'customCron',
            message: 'Cron expression must have exactly 5 fields (minute hour day month weekday)',
            type: 'error',
          })
        }
      }
    }

    return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
  } catch (error) {
    console.error('Scheduled trigger validation error:', error)
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          type: 'error' as const,
        })),
      }
    }
    return {
      isValid: false,
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' as const }],
    }
  }
}

/**
 * Extract variable references from scheduled trigger configuration
 */
function extractScheduledTriggerVariables(data: ScheduledTriggerNodeData): string[] {
  const variables: string[] = []
  const { config } = data

  // Extract variables from interval values
  if (config.triggerInterval !== 'custom') {
    const intervalValue = config.timeBetweenTriggers[config.triggerInterval]
    const isConstant = config.timeBetweenTriggers.isConstant ?? true

    if (!isConstant && typeof intervalValue === 'string' && intervalValue.trim()) {
      variables.push(intervalValue)
    }
  }

  return [...new Set(variables)]
}

/**
 * Define output variables for scheduled trigger node
 */
function getScheduledTriggerOutputVariables(
  data: ScheduledTriggerNodeData,
  nodeId: string
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []

  // Triggered at timestamp
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'triggered_at', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'ISO timestamp when the scheduled trigger was executed',
    })
  )

  // Schedule type
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'schedule_type', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'Type of schedule (interval or cron)',
    })
  )

  // Test run indicator
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'is_test_run', // Changed from 'name' to 'path'
      type: BaseType.BOOLEAN,
      description: 'Whether this is a manual test run or actual scheduled execution',
    })
  )

  // Schedule configuration
  if (data.config.triggerInterval === 'custom') {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'cron_expression', // Changed from 'name' to 'path'
        type: BaseType.STRING,
        description: 'The cron expression used for scheduling',
      })
    )
  } else {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'interval_config', // Changed from 'name' to 'path'
        type: BaseType.OBJECT,
        description: 'The interval configuration used for scheduling',
      })
    )
  }

  return variables
}

/**
 * Scheduled trigger node definition
 */
export const scheduledTriggerDefinition: NodeDefinition<ScheduledTriggerNodeData> = {
  id: NodeType.SCHEDULED,
  category: NodeCategory.TRIGGER,
  displayName: 'Scheduled Trigger',
  description: 'Trigger workflow on a schedule',
  icon: 'clock',
  color: '#10b981', // TRIGGER category color
  schema: scheduledTriggerNodeDataSchema,
  defaultData: scheduledTriggerDefaultData,
  canRunSingle: false,
  panel: ScheduledTriggerPanel,
  triggerType: WorkflowTriggerType.SCHEDULED,
  validator: validateScheduledTriggerData,
  extractVariables: extractScheduledTriggerVariables,
  outputVariables: getScheduledTriggerOutputVariables as any,
}
