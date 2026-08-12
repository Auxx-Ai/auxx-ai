// apps/web/src/components/workflow/nodes/core/wait/schema.ts

import { WAIT_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { z } from 'zod'
import {
  NodeCategory,
  type NodeDefinition,
  type ValidationResult,
} from '~/components/workflow/types'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { BaseType } from '../if-else'
import { DurationUnit, type WaitNodeData, WaitType } from './types'

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
 * Default configuration for new wait nodes
 */
export const waitDefaultData: Partial<WaitNodeData> = {
  title: 'Wait',
  description: '',
  waitType: WaitType.DURATION,
  durationAmount: 5,
  isDurationConstant: true,
  durationUnit: DurationUnit.SECONDS,
  time: undefined,
  isTimeConstant: true,
}

/**
 * Validation function for wait configuration
 */
export const validateWaitConfig = (data: WaitNodeData): ValidationResult => {
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
 * Wait node definition
 */
export const waitDefinition: NodeDefinition<WaitNodeData> = {
  id: NodeType.WAIT,
  category: NodeCategory.UTILITY,
  displayName: 'Wait',
  description: 'Pause workflow execution for a specified duration',
  icon: 'clock',
  color: '#3B82F6', // UTILITY category color
  defaultData: waitDefaultData,
  schema: waitNodeDataSchema,
  validator: validateWaitConfig,
  canRunSingle: true,
  extractVariables: () => [], // Wait node doesn't use any variables
  outputVariables: getWaitOutputVariables,
}
