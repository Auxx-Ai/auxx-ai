// packages/lib/src/workflow-engine/catalog/nodes/scheduled.ts

import { z } from 'zod'
import { BaseType, WorkflowTriggerType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * Frontend-facing interface that matches user requirements
 */
export interface ScheduledTriggerUIConfig {
  triggerInterval: 'minutes' | 'hours' | 'days' | 'weeks' | 'custom'
  timeBetweenTriggers: {
    minutes?: number | string
    hours?: number | string
    days?: number | string
    weeks?: number | string
    isConstant?: boolean
  }
  customCron?: string
  timezone?: string
  startDate?: string // Optional start date for scheduling
}

/**
 * Node data structure for scheduled trigger
 */
export interface ScheduledTriggerNodeData extends BaseNodeData {
  config: ScheduledTriggerUIConfig
  isEnabled: boolean
}

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
 * Validate scheduled trigger node data
 */
export function validateScheduledTriggerData(data: ScheduledTriggerNodeData): NodeValidationResult {
  const parsed = scheduledTriggerNodeDataSchema.safeParse(data)
  if (!parsed.success) {
    return {
      isValid: false,
      errors: parsed.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
        type: 'error' as const,
      })),
    }
  }

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
}

/**
 * Extract variable references from scheduled trigger configuration
 */
export function extractScheduledTriggerVariables(data: ScheduledTriggerNodeData): string[] {
  const variables: string[] = []
  const { config } = data
  // Legacy/imported rows can lack `config` entirely; nothing to extract.
  if (!config) return variables

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
      path: 'triggered_at',
      type: BaseType.STRING,
      description: 'ISO timestamp when the scheduled trigger was executed',
    })
  )

  // Schedule type
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'schedule_type',
      type: BaseType.STRING,
      // Vocabulary defined once, engine-side, in `SCHEDULE_KINDS`
      // (`packages/lib/src/workflow-engine/nodes/trigger-nodes/scheduled.ts`).
      // This is the kind of schedule, never the interval unit — the unit is
      // published separately as `interval_config.unit`.
      description: "Kind of schedule this trigger runs on: 'interval' or 'cron'",
    })
  )

  // Test run indicator
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'is_test_run',
      type: BaseType.BOOLEAN,
      description: 'Whether this is a manual test run or actual scheduled execution',
    })
  )

  // Schedule configuration. `config` can be absent on legacy/imported rows —
  // fall through to the interval branch, matching `defaultData()`'s shape.
  if (data.config?.triggerInterval === 'custom') {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'cron_expression',
        type: BaseType.STRING,
        description: 'The cron expression used for scheduling',
      })
    )
  } else {
    variables.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'interval_config',
        type: BaseType.OBJECT,
        description:
          "The interval used for scheduling: `{ unit, value }`, where `unit` is 'minutes' | 'hours' | 'days' | 'weeks'",
      })
    )
  }

  return variables
}

/**
 * Scheduled trigger node manifest
 */
export const scheduledTriggerManifest: NodeManifest<ScheduledTriggerNodeData> = {
  id: 'scheduled',
  category: NodeCategory.TRIGGER,
  displayName: 'Scheduled Trigger',
  description: 'Trigger workflow on a schedule',
  icon: 'clock',
  color: '#10b981', // TRIGGER category color
  triggerType: WorkflowTriggerType.SCHEDULED,
  defaultData: () => ({
    config: {
      triggerInterval: 'hours',
      timeBetweenTriggers: { hours: 1, isConstant: true },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    isEnabled: true,
  }),
  configSchema: scheduledTriggerNodeDataSchema as unknown as z.ZodType<ScheduledTriggerNodeData>,
  validate: validateScheduledTriggerData,
  extractVariables: extractScheduledTriggerVariables,
  resolveOutputs: getScheduledTriggerOutputVariables,
  connection: {
    canRunSingle: false,
  },
  agent: {
    authorable: true,
    usage:
      'config.triggerInterval is one of minutes|hours|days|weeks|custom. For interval kinds, ' +
      'set the matching key in config.timeBetweenTriggers; for "custom", set config.customCron ' +
      '(5-field cron). Timezone is IANA.',
    examples: [
      {
        description: 'Every 2 hours',
        config: {
          config: {
            triggerInterval: 'hours',
            timeBetweenTriggers: { hours: 2, isConstant: true },
          },
          isEnabled: true,
        },
      },
    ],
  },
}
