// apps/web/src/components/workflow/nodes/core/message-received/types.ts

import type { CatalogMessageReceivedNodeData } from '@auxx/lib/workflow-engine/client'
import type { ExecutionResult } from '~/components/workflow/types'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/message-received`);
// MessageReceivedNodeData narrows `type` to the web NodeType enum, same as
// BaseNodeData does over its lib counterpart.

/**
 * Node data for message-received nodes (flattened structure)
 */
export interface MessageReceivedNodeData extends CatalogMessageReceivedNodeData {
  type: NodeType
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
