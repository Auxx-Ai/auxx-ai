// apps/web/src/components/workflow/nodes/core/answer/types.ts

import type { BaseNodeData, ExecutionResult, SpecificNode } from '../../../types'

/**
 * Node data for answer nodes with flattened structure
 */
export interface AnswerNodeData extends BaseNodeData {
  // 'new' = compose fresh email, 'reply' = reply to sender, 'replyAll' = reply to all
  messageType: 'new' | 'reply' | 'replyAll'

  integrationId?: string // Required for 'new', auto-derived for reply/replyAll
  recordId?: string // Format: "entityDefinitionId:id" (e.g. "thread:abc123", "message:xyz789")
  // Required for reply/replyAll. Replaces old resourceId + resourceType.

  // Per-field auto-resolve toggles (reply/replyAll only, ignored for 'new')
  // true (default): system auto-resolves from thread at execution time
  // false: user provides the value explicitly
  toIsAuto?: boolean
  ccIsAuto?: boolean
  bccIsAuto?: boolean
  subjectIsAuto?: boolean

  to?: string[]
  toModes?: boolean[]
  cc?: string[]
  ccModes?: boolean[]
  bcc?: string[]
  bccModes?: boolean[]
  text: string
  subject?: string
  attachments?: Array<{
    name: string
    url: string
  }>
  attachmentFiles?: string[]
  attachmentFilesModes?: boolean[]
}

/**
 * Full Answer node type for React Flow
 */
export type AnswerNode = SpecificNode<'answer', AnswerNodeData>

/**
 * Execution result for answer nodes
 */
export interface AnswerExecutionResult extends ExecutionResult {
  outputs: {
    message_sent: boolean
    message_id?: string
    recipients?: string[]
  }
}
