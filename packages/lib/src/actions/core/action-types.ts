// packages/lib/src/actions/core/action-types.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import { IntegrationProviderType as IntegrationProvider } from '@auxx/database/types'
import {
  ProviderCapabilities as CoreProviderCapabilities,
  getProviderCapabilities as getCoreProviderCapabilities,
} from '../../providers/provider-capabilities'

/**
 * Provider-Aware Action Types for Multi-Provider Message Processing
 *
 * These action types are designed to work across different message providers
 * (EMAIL, FACEBOOK, SMS, WHATSAPP, INSTAGRAM, OPENPHONE, CHAT) where each
 * provider has different capabilities and limitations.
 */

export enum ActionType {
  // Universal actions (supported by all providers)
  SEND_MESSAGE = 'SEND_MESSAGE',
  APPLY_TAG = 'APPLY_TAG', // Internal tag system
  REMOVE_TAG = 'REMOVE_TAG',

  // Email-specific actions
  REPLY = 'REPLY',
  FORWARD = 'FORWARD',
  DRAFT_EMAIL = 'DRAFT_EMAIL',
  APPLY_LABEL = 'APPLY_LABEL', // Provider labels
  REMOVE_LABEL = 'REMOVE_LABEL',
  ARCHIVE = 'ARCHIVE',
  MARK_SPAM = 'MARK_SPAM',
  MARK_TRASH = 'MARK_TRASH', // Move to trash (NEW)

  // Thread operations (via ThreadMutationService)
  ASSIGN_THREAD = 'ASSIGN_THREAD',
  ARCHIVE_THREAD = 'ARCHIVE_THREAD',
  UNARCHIVE_THREAD = 'UNARCHIVE_THREAD',
  MOVE_TO_TRASH = 'MOVE_TO_TRASH', // Alias for MARK_TRASH

  // Social media actions
  REACT_TO_MESSAGE = 'REACT_TO_MESSAGE',
  SHARE_MESSAGE = 'SHARE_MESSAGE',

  // SMS/Phone actions
  SEND_SMS = 'SEND_SMS',
  MAKE_CALL = 'MAKE_CALL',

  // Workflow actions
  ESCALATE = 'ESCALATE',
  ASSIGN = 'ASSIGN',
  NOTIFY = 'NOTIFY',
  CREATE_TICKET = 'CREATE_TICKET',

  // Shopify-specific actions
  SHOPIFY_ORDER_LOOKUP = 'SHOPIFY_ORDER_LOOKUP',
  SHOPIFY_GENERATE_RESPONSE = 'SHOPIFY_GENERATE_RESPONSE',
}

/**
 * Re-export provider capabilities from centralized location
 * @deprecated Use ProviderCapabilities from provider-capabilities.ts instead
 */
export type ProviderCapabilities = CoreProviderCapabilities

/**
 * Action parameters - flexible structure for different action types
 */
export interface ActionParams {
  // Common parameters
  threadId?: string
  messageId?: string
  userId?: string

  // Message content
  subject?: string
  content?: string
  textHtml?: string
  textPlain?: string

  // Recipients
  to?: string[]
  cc?: string[]
  bcc?: string[]

  // Labels and tags
  tagId?: string
  tagIds?: string[]
  labelId?: string
  labelName?: string

  // Assignment
  assigneeId?: string

  // Shopify specific
  orderId?: string
  customerId?: string

  // Thread operations
  threadIds?: string[] // For bulk operations
  status?: string

  // Generic parameters for extensibility
  [key: string]: any
}

/**
 * Action definition with metadata and fallback support
 */
export interface ActionDefinition {
  id?: string // Unique identifier for tracking
  type: ActionType
  params: ActionParams
  fallbackActions?: ActionDefinition[] // Fallback if primary action unsupported
  metadata?: {
    ruleId?: string
    priority?: number
    requiresCapability?: keyof ProviderCapabilities
    createdAt?: Date
    executedAt?: Date
    retryCount?: number
    maxRetries?: number
  }
}

/**
 * Action execution context
 * Note: integrationType removed from message - use integration.provider instead
 */
export interface ActionContext {
  userId: string
  organizationId: string
  message: {
    id: string
    threadId: string
    integrationId: string
    externalId?: string
    subject?: string
    snippet?: string
  }
  thread?: {
    id: string
    externalId?: string
    status: string
    lastMessageAt: Date
  }
  integration?: {
    id: string
    provider: string
    enabled: boolean
    metadata?: any
  }
  requestId?: string // For tracking
  timestamp: Date
}

/**
 * Action execution result
 */
export interface ActionResult {
  actionId: string
  actionType: ActionType
  success: boolean
  result?: any
  error?: string
  executionTime: number // timestamp
  metadata?: {
    providerId?: string
    externalId?: string
    threadId?: string
    messageId?: string
    fallbackUsed?: boolean
    retryAttempt?: number
    [key: string]: any
  }
}

/**
 * Batch action result for bulk operations
 */
export interface BatchActionResult {
  batchId: string
  totalActions: number
  successCount: number
  failureCount: number
  results: ActionResult[]
  executionTime: number
  errors?: string[]
}

/**
 * Action handler interface
 */
export interface ActionHandler {
  handle(action: ActionDefinition, context: ActionContext, provider?: any): Promise<ActionResult>

  // Optional bulk operation support
  handleBulk?(
    actions: ActionDefinition[],
    context: ActionContext,
    provider?: any
  ): Promise<BatchActionResult>

  // Capability checking
  canHandle?(actionType: ActionType, providerCapabilities: ProviderCapabilities): boolean
}

/**
 * Action executor interface
 */
export interface ActionExecutor {
  execute(action: ActionDefinition, context: ActionContext): Promise<ActionResult>

  executeBatch(actions: ActionDefinition[], context: ActionContext): Promise<BatchActionResult>

  validateAction(action: ActionDefinition, context: ActionContext): Promise<boolean>
}

/**
 * Provider capability constants - use centralized capabilities
 * @deprecated Use getProviderCapabilities() from provider-capabilities.ts instead
 */
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  // Enum keys
  [IntegrationProviderType.google]: getCoreProviderCapabilities(IntegrationProviderType.google),
  [IntegrationProviderType.outlook]: getCoreProviderCapabilities(IntegrationProviderType.outlook),
  [IntegrationProviderType.facebook]: getCoreProviderCapabilities(IntegrationProviderType.facebook),
  [IntegrationProviderType.instagram]: getCoreProviderCapabilities(
    IntegrationProviderType.instagram
  ),
  [IntegrationProviderType.openphone]: getCoreProviderCapabilities(
    IntegrationProviderType.openphone
  ),
  [IntegrationProviderType.mailgun]: getCoreProviderCapabilities(IntegrationProviderType.mailgun),

  // Legacy string keys for backward compatibility (since enum values are already strings, this adds them again)
  google: getCoreProviderCapabilities(IntegrationProviderType.google),
  outlook: getCoreProviderCapabilities(IntegrationProviderType.outlook),
  facebook: getCoreProviderCapabilities(IntegrationProviderType.facebook),
  instagram: getCoreProviderCapabilities(IntegrationProviderType.instagram),
  openphone: getCoreProviderCapabilities(IntegrationProviderType.openphone),
  mailgun: getCoreProviderCapabilities(IntegrationProviderType.mailgun),
}

/**
 * Helper function to get provider capabilities
 * @deprecated Use getProviderCapabilities() from provider-capabilities.ts instead
 */
export function getProviderCapabilities(
  providerType: string | IntegrationProvider
): ProviderCapabilities {
  // Handle both string and enum inputs
  const enumValue =
    typeof providerType === 'string'
      ? (Object.values(IntegrationProviderType).find(
          (p) => p === providerType
        ) as IntegrationProvider)
      : providerType

  if (enumValue) {
    return getCoreProviderCapabilities(enumValue)
  }

  // Fallback for unknown providers
  return getCoreProviderCapabilities(IntegrationProviderType.email) // Default to generic email capabilities
}

/**
 * Helper function to check if an action is supported by a provider
 */
export function isActionSupported(
  actionType: ActionType,
  providerCapabilities: ProviderCapabilities
): boolean {
  switch (actionType) {
    case ActionType.SEND_MESSAGE:
    case ActionType.SEND_SMS:
      return providerCapabilities.canSend

    case ActionType.REPLY:
      return providerCapabilities.canReply

    case ActionType.FORWARD:
      return providerCapabilities.canForward

    case ActionType.DRAFT_EMAIL:
      return providerCapabilities.canDraft

    case ActionType.APPLY_LABEL:
      return providerCapabilities.canApplyLabel

    case ActionType.REMOVE_LABEL:
      return providerCapabilities.canRemoveLabel

    case ActionType.ARCHIVE:
    case ActionType.ARCHIVE_THREAD:
      return providerCapabilities.canArchive

    case ActionType.MARK_SPAM:
      return providerCapabilities.canMarkSpam

    case ActionType.MARK_TRASH:
    case ActionType.MOVE_TO_TRASH:
      return providerCapabilities.canMarkTrash

    case ActionType.ASSIGN_THREAD:
    case ActionType.ASSIGN:
      return providerCapabilities.canAssignThreads

    case ActionType.REACT_TO_MESSAGE:
      return providerCapabilities.canReact

    case ActionType.SHARE_MESSAGE:
      return providerCapabilities.canShare

    // Universal actions that work across all providers
    case ActionType.APPLY_TAG:
    case ActionType.REMOVE_TAG:
    case ActionType.ESCALATE:
    case ActionType.NOTIFY:
    case ActionType.CREATE_TICKET:
      return true

    default:
      return false
  }
}
