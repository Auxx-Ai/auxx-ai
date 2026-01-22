// apps/web/src/components/workflow/nodes/core/message-received/types.ts

import { type ExecutionResult } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Node data for message-received nodes (flattened structure)
 */
export interface MessageReceivedNodeData extends BaseNodeData {
  desc?: string // Legacy field, prefer description
  filters?: { from?: string[]; subject_contains?: string[]; body_contains?: string[] }
  message_filter?: {
    enabled: boolean
    conditions: Array<{
      field: 'from' | 'subject' | 'body'
      operator: 'contains' | 'equals' | 'regex'
      value: string
    }>
  }
}

/**
 * Full Message Received node type for React Flow
 */
export type MessageReceivedNode = SpecificNode<'message-received', MessageReceivedNodeData>

/**
 * Execution result for message-received nodes
 */
export interface MessageReceivedExecutionResult extends ExecutionResult {
  outputs: {
    message: {
      id: string
      from: string
      to: string[]
      subject: string
      body: string
      timestamp: string
      attachments?: Array<{ name: string; url: string; size: number }>
    }
    conversation: { id: string; thread_id: string }
    contact: { id: string; email: string; name?: string }
  }
}
