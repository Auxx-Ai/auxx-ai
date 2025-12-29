// apps/web/src/components/workflow/nodes/core/answer/types.ts

import { BaseNodeData, SpecificNode, ExecutionResult } from '../../../types'

/**
 * Node data for answer nodes with flattened structure
 */
export interface AnswerNodeData extends BaseNodeData {
  messageType: 'new' | 'reply'
  integrationId?: string
  resourceType?: 'thread' | 'message'
  resourceId?: string
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
