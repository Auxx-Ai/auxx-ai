// packages/lib/src/workflow-engine/catalog/nodes/human.ts

import { z } from 'zod'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema, type TargetBranch } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'

/**
 * Configuration data for the Human Confirmation node
 */
export interface HumanConfirmationNodeData extends BaseNodeData {
  // Basic configuration
  /** Message displayed to reviewers when requesting confirmation */
  message?: string

  /** Assignees who can approve or deny the request */
  assignees: {
    /** ActorId format: ["user:abc", "group:xyz"] */
    actorIds?: string[]
    /** Dynamic assignee from workflow variable */
    variable?: UnifiedVariable
  }

  // Notification settings
  /** Methods to notify assignees about the confirmation request */
  notification_methods: {
    /**
     * Ping assignees live (bell pulse + sound). Not "surface this in-app" — the
     * Approvals tab and bell badge read `ApprovalRequest` directly, so turning
     * this off hides nothing (plans/today/05-bell-and-feed-dedupe.md §2).
     */
    in_app: boolean
    /** Send email notifications, if the recipient's own email preference allows. */
    email: boolean
  }

  // Timeout settings
  /** Configuration for when the request expires */
  timeout: {
    /** Whether timeout is enabled (defaults to true) */
    enabled?: boolean
    /** Duration before timeout (can be dynamic) */
    duration: number | UnifiedVariable
    /** Unit of time for the duration */
    unit: 'minutes' | 'hours' | 'days'
  }

  /** Optional reminder configuration */
  reminders?: {
    /** Whether reminders are enabled */
    enabled: boolean
    /** When to send first reminder */
    first_after: number
    /** How often to repeat reminders */
    repeat_every: number
    /** Maximum number of reminders to send */
    max_reminders: number
    /** Unit of time for reminder intervals */
    unit: 'minutes' | 'hours' | 'days'
  }

  /** Whether users must be logged in to respond */
  require_login: boolean

  // Test mode configuration
  /** Behavior when running in test mode ('delayed' takes the timeout branch) */
  test_behavior?: 'always_approve' | 'always_deny' | 'random' | 'delayed' | 'live'
  /** Delay in seconds for 'delayed' test behavior */
  test_delay?: number

  // Additional metadata
  /** Whether to include workflow context in the approval request */
  include_workflow_context?: boolean

  // Branch configuration
  /** Target branches for human confirmation outcomes */
  _targetBranches?: TargetBranch[]
}

/**
 * Zod schema for human confirmation node data
 */
export const humanConfirmationNodeDataSchema = baseNodeDataSchema.extend({
  message: z.string().optional(),
  // The assignee refinement is a COMPLETENESS rule and lives in
  // `validateHumanConfirmationConfig` — the legacy schema-level .refine made
  // the default data (empty actorIds, no variable) fail its own schema, the
  // class the catalog defaults-parse test exists for.
  assignees: z.object({
    actorIds: z.array(z.string()).optional(),
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
  test_behavior: z.enum(['always_approve', 'always_deny', 'random', 'delayed', 'live']).optional(),
  test_delay: z.number().optional(),
  include_workflow_context: z.boolean().optional(),
})

/**
 * Validation function for human confirmation configuration
 */
export const validateHumanConfirmationConfig = (
  data: HumanConfirmationNodeData
): NodeValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Check assignees
  const hasActorIds = (data.assignees?.actorIds?.length ?? 0) > 0
  const hasVariable = !!data.assignees?.variable

  if (!hasActorIds && !hasVariable) {
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
const getHumanConfirmationOutputVariables = (
  _data: HumanConfirmationNodeData,
  nodeId: string
): any[] => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'approved_by',
      type: BaseType.STRING,
      description: 'User ID of the approver (empty if denied or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'denied_by',
      type: BaseType.STRING,
      description: 'User ID of the denier (empty if approved or timeout)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_time',
      type: BaseType.NUMBER,
      description: 'Time taken to respond in seconds',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'outcome',
      type: BaseType.STRING,
      description: 'The outcome: approved, denied, or timeout',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response_message',
      type: BaseType.STRING,
      description: 'Optional message from the reviewer',
    }),
  ]
}

/**
 * Human confirmation node manifest.
 * Note: the type id is 'human-confirmation'; the web folder is `core/human`.
 */
export const humanConfirmationManifest: NodeManifest<HumanConfirmationNodeData> = {
  id: 'human-confirmation',
  category: NodeCategory.CONDITION,
  displayName: 'Human Review',
  description: 'Pause workflow and wait for human approval',
  icon: 'user-check',
  color: '#f59e0b', // CONDITION category color
  defaultData: () => ({
    title: 'Human Review',
    description: 'Wait for human approval before proceeding',
    message: '',
    assignees: { actorIds: [] },
    notification_methods: { in_app: true, email: true },
    timeout: { enabled: true, duration: 24, unit: 'hours' },
    require_login: true,
    include_workflow_context: true,
    test_behavior: 'always_approve',
  }),
  configSchema: humanConfirmationNodeDataSchema as unknown as z.ZodType<HumanConfirmationNodeData>,
  validate: validateHumanConfirmationConfig,
  extractVariables: () => [], // Human confirmation doesn't extract variables
  resolveOutputs: getHumanConfirmationOutputVariables,
  connection: {
    canRunSingle: false,
    /** Three-way outcome routing — not two-way. */
    branches: (): NodeBranch[] => [
      { id: 'approved', name: 'Approved', kind: 'default' },
      { id: 'denied', name: 'Denied', kind: 'default' },
      { id: 'timeout', name: 'Timeout', kind: 'default' },
    ],
  },
  agent: {
    authorable: true,
    usage:
      'Pauses the run for approval. `assignees.actorIds` uses ActorId format ' +
      '("user:<id>", "group:<id>"). Wire all three branches: approved, denied, timeout. ' +
      'Outputs: outcome, approved_by, denied_by, response_time, response_message.',
    examples: [
      {
        description: 'Manager approval with a 4h timeout',
        config: {
          message: 'Approve refund for {{find-1.ticket.subject}}?',
          assignees: { actorIds: ['group:managers'] },
          notification_methods: { in_app: true, email: true },
          timeout: { enabled: true, duration: 4, unit: 'hours' },
          require_login: true,
        },
      },
    ],
  },
}
