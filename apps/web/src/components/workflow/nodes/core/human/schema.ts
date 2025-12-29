// apps/web/src/components/workflow/nodes/core/human/schema.ts

import { z } from 'zod'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
  BaseType,
} from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { type HumanConfirmationNodeData } from './types'
import { HumanConfirmationNodePanel } from './panel'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'

/**
 * Zod schema for human confirmation node data
 */
export const humanConfirmationNodeDataSchema = baseNodeDataSchema
  .extend({
    message: z.string().optional(),
    assignees: z.object({
      userIds: z.array(z.string()).optional(),
      groups: z.array(z.string()).optional(),
      variable: z.any().optional(), // UnifiedVariable
    }),
    notification_methods: z.object({ in_app: z.boolean(), email: z.boolean() }),
    timeout: z.object({
      enabled: z.boolean().optional(), // defaults to true
      duration: z.union([z.number(), z.any()]), // number or UnifiedVariable
      unit: z.enum(['minutes', 'hours', 'days']),
    }),
    reminders: z
      .object({
        enabled: z.boolean(),
        first_after: z.number(),
        repeat_every: z.number(),
        max_reminders: z.number(),
        unit: z.enum(['minutes', 'hours', 'days']),
      })
      .optional(),
    require_login: z.boolean().default(true),
    test_behavior: z
      .enum(['always_approve', 'always_deny', 'random', 'delayed', 'live'])
      .optional(),
    test_delay: z.number().optional(),
    include_workflow_context: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // At least one assignee method required
      return (
        data.assignees?.userIds?.length > 0 ||
        data.assignees?.groups?.length > 0 ||
        data.assignees?.variable !== undefined
      )
    },
    { message: 'At least one assignee is required' }
  )

/**
 * Default configuration for new human confirmation nodes
 */
export const humanConfirmationDefaultData: Partial<HumanConfirmationNodeData> = {
  title: 'Human Review',
  description: 'Wait for human approval before proceeding',
  message: '',
  assignees: { userIds: [], groups: [] },
  notification_methods: { in_app: true, email: true },
  timeout: { enabled: true, duration: 24, unit: 'hours' },
  require_login: true,
  include_workflow_context: true,
  test_behavior: 'always_approve',
}

/**
 * Validation function for human confirmation configuration
 */
export const validateHumanConfirmationConfig = (
  data: HumanConfirmationNodeData
): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Check assignees
  const hasUsers = data.assignees?.userIds?.length > 0
  const hasGroups = data.assignees?.groups?.length > 0
  const hasVariable = !!data.assignees?.variable

  if (!hasUsers && !hasGroups && !hasVariable) {
    errors.push({ field: 'assignees', message: 'At least one assignee is required', type: 'error' })
  }

  // Check notification methods
  if (!data.notification_methods?.in_app && !data.notification_methods?.email) {
    errors.push({
      field: 'notification_methods',
      message: 'At least one notification method must be selected',
      type: 'error',
    })
  }

  // Check timeout (only if enabled)
  if (data.timeout?.enabled !== false) {
    // Default to true if not specified
    if (!data.timeout?.duration) {
      errors.push({
        field: 'timeout.duration',
        message: 'Timeout duration is required when timeout is enabled',
        type: 'error',
      })
    } else if (typeof data.timeout.duration === 'number' && data.timeout.duration <= 0) {
      errors.push({
        field: 'timeout.duration',
        message: 'Timeout duration must be greater than 0',
        type: 'error',
      })
    }

    if (!data.timeout?.unit) {
      errors.push({
        field: 'timeout.unit',
        message: 'Timeout unit is required when timeout is enabled',
        type: 'error',
      })
    }
  }

  // Warnings
  if (
    data.timeout?.enabled !== false &&
    data.timeout &&
    typeof data.timeout.duration === 'number'
  ) {
    const durationInMinutes =
      data.timeout.unit === 'minutes'
        ? data.timeout.duration
        : data.timeout.unit === 'hours'
          ? data.timeout.duration * 60
          : data.timeout.duration * 1440

    if (durationInMinutes > 10080) {
      // More than 7 days
      errors.push({
        field: 'timeout.duration',
        message: 'Very long timeout periods may affect workflow performance',
        type: 'warning',
      })
    }
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Output variables function for human confirmation node
 */
export const getHumanConfirmationOutputVariables = (
  data: HumanConfirmationNodeData,
  nodeId: string
): any[] => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'approved_by', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'User ID of the approver (empty if denied or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'denied_by', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'User ID of the denier (empty if approved or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_time', // Changed from 'name' to 'path'
      type: BaseType.NUMBER,
      description: 'Time taken to respond in seconds',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'outcome', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'The outcome: approved, denied, or timeout',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_message', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'Optional message from the reviewer',
    }),
  ]
}

/**
 * Human confirmation node definition
 */
export const humanConfirmationDefinition: NodeDefinition<HumanConfirmationNodeData> = {
  id: NodeType.HUMAN_CONFIRMATION,
  category: NodeCategory.CONDITION,
  displayName: 'Human Review',
  description: 'Pause workflow and wait for human approval',
  icon: 'user-check',
  color: '#f59e0b', // CONDITION category color
  defaultData: humanConfirmationDefaultData,
  schema: humanConfirmationNodeDataSchema,
  panel: HumanConfirmationNodePanel,
  validator: validateHumanConfirmationConfig,
  canRunSingle: false,
  extractVariables: () => [], // Human confirmation doesn't extract variables
  outputVariables: getHumanConfirmationOutputVariables,
}
