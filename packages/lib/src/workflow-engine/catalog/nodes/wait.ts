// packages/lib/src/workflow-engine/catalog/nodes/wait.ts

import { z } from 'zod'
import { WAIT_CONSTANTS } from '../../constants'
import { BaseType } from '../../core/types'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The wait node's catalog manifest — the first migrated node type and the
 * template for the rest. The data half (enums, data interface, zod schema,
 * defaults, validator) lives here as the single source; apps/web
 * `core/wait/schema.ts` merges it with the React parts via
 * `defineFromManifest`, and the engine's `nodes/wait/types.ts` re-exports the
 * enums instead of re-declaring them.
 *
 * Engine note: compiled sequence graphs extend the persisted config with
 * `deliveryWindow` / `anchor` (see `workflow-engine/nodes/wait/types.ts`).
 * Those are compiler-written, never builder-authored, so they are not part of
 * this schema — and zod's default object behavior tolerates the extra keys.
 */

/**
 * Wait type options
 */
export enum WaitType {
  DURATION = 'duration',
  SPECIFIC_TIME = 'specific_time',
}

/**
 * Duration unit options
 */
export enum DurationUnit {
  SECONDS = 'seconds',
  MINUTES = 'minutes',
  HOURS = 'hours',
  DAYS = 'days',
}

/**
 * Wait node data interface with complete structure
 */
export interface WaitNodeData extends BaseNodeData {
  /** Type of wait operation */
  waitType: WaitType
  /** Duration amount for duration-based wait */
  durationAmount?: number | string
  isDurationConstant: boolean
  /** Duration unit for duration-based wait */
  durationUnit?: DurationUnit
  /** Specific time for time-based wait */
  time?: string
  isTimeConstant: boolean
  /** Timezone for specific time wait */
  timezone?: string
}

/**
 * Zod schema for wait node data
 */
export const waitNodeDataSchema = baseNodeDataSchema
  .extend({
    waitType: z.enum(WaitType),
    durationAmount: z
      .union([
        z.number().min(WAIT_CONSTANTS.DURATION.MIN).max(WAIT_CONSTANTS.DURATION.MAX),
        z.string(),
        z.object({ id: z.string(), nodeId: z.string().optional(), path: z.string() }), // UnifiedVariable
      ])
      .optional(),
    isDurationConstant: z.boolean().default(true),
    durationUnit: z.enum(DurationUnit).optional(),
    time: z
      .union([
        z.string(),
        z.object({ id: z.string(), nodeId: z.string().optional(), path: z.string() }), // UnifiedVariable
      ])
      .optional(),
    isTimeConstant: z.boolean().default(true),
    timezone: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.waitType === WaitType.DURATION) {
        return data.durationAmount !== undefined && data.durationUnit !== undefined
      }
      return data.time !== undefined
    },
    { message: 'Required fields missing for selected wait type' }
  )

/**
 * Validation function for wait configuration
 */
export const validateWaitConfig = (data: WaitNodeData): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate wait type
  if (!data.waitType) {
    errors.push({ field: 'waitType', message: 'Wait type is required', type: 'error' })
  } else if (data.waitType === WaitType.DURATION) {
    // Validate duration-based wait
    if (!data.durationAmount) {
      errors.push({
        field: 'durationAmount',
        message: 'Duration amount is required',
        type: 'error',
      })
    }
    if (!data.durationUnit) {
      errors.push({ field: 'durationUnit', message: 'Duration unit is required', type: 'error' })
    }
  } else if (data.waitType === WaitType.SPECIFIC_TIME) {
    // Validate specific time wait
    if (!data.time) {
      errors.push({
        field: 'time',
        message: 'Time is required for specific time wait',
        type: 'error',
      })
    }
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Get output variables for wait node.
 *
 * All four are advertised unconditionally, because `WaitNodeProcessor` writes all four on
 * both execution paths. Which path a wait takes (setTimeout vs the delay queue) is a
 * RUNTIME decision — a variable duration, delivery-window snapping or dry-run capping can
 * each flip it — so gating `paused_at`/`resume_at` on the configured duration would offer
 * the author a variable that resolves to nothing on half their runs.
 */
const getWaitOutputVariables = (_data: WaitNodeData, nodeId: string): any[] => [
  createUnifiedOutputVariable({
    nodeId,
    path: 'wait_duration_ms',
    type: BaseType.NUMBER,
    description: 'Total wait time in milliseconds',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'wait_method',
    type: BaseType.STRING,
    description: 'Method used for waiting (short_delay or queue_delay)',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'paused_at',
    type: BaseType.STRING,
    description: 'ISO timestamp when the wait started',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'resume_at',
    type: BaseType.STRING,
    description: 'ISO timestamp when execution resumes',
  }),
]

/**
 * Wait node manifest
 */
export const waitManifest: NodeManifest<WaitNodeData> = {
  id: 'wait',
  category: NodeCategory.UTILITY,
  displayName: 'Wait',
  description: 'Pause workflow execution for a specified duration',
  icon: 'clock',
  color: '#3B82F6', // UTILITY category color
  defaultData: () => ({
    title: 'Wait',
    description: '',
    waitType: WaitType.DURATION,
    durationAmount: 5,
    isDurationConstant: true,
    durationUnit: DurationUnit.SECONDS,
    time: undefined,
    isTimeConstant: true,
  }),
  configSchema: waitNodeDataSchema as unknown as z.ZodType<WaitNodeData>,
  validate: validateWaitConfig,
  extractVariables: () => [], // Wait node doesn't use any variables
  resolveOutputs: getWaitOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Pause the workflow. waitType "duration" needs durationAmount + durationUnit; ' +
      'waitType "specific_time" needs time (and optionally timezone).',
    examples: [
      {
        description: 'Wait 10 minutes',
        config: { waitType: 'duration', durationAmount: 10, durationUnit: 'minutes' },
      },
    ],
  },
}
