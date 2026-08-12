// apps/web/src/components/workflow/nodes/core/human/types.ts

import type { TargetBranch, UnifiedVariable } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

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
 * Complete type for the Human Confirmation node
 */
export type HumanConfirmationNode = SpecificNode<'human', HumanConfirmationNodeData>
