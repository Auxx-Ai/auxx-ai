// apps/web/src/components/workflow/nodes/core/message-received/types.ts

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ExecutionResult } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Node data for message-received nodes (flattened structure)
 */
export interface MessageReceivedNodeData extends BaseNodeData {
  desc?: string // Legacy field, prefer description
  /**
   * Channel scope, which channels' inbound mail can start this workflow.
   * `undefined`/empty means **all channels** (the default, publish never
   * forces a choice). Read by the `triggerMessageWorkflows` dispatcher off the
   * published graph (`triggerNode.data.channelIds`), not by the runtime node
   * itself. The "Inboxes" picker in the panel is UI sugar only: picking an
   * inbox writes that inbox's channel ids in here.
   */
  channelIds?: string[]
  /**
   * Soft-tier machine-mail handling (out-of-office replies, mailing-list /
   * notification mail). `'exclude'` (the default when absent) skips this
   * workflow for soft machine mail; `'include'` opts it in. Read off the
   * published graph by the `triggerMessageWorkflows` dispatcher. Hard-tier
   * machine mail (bounces / delivery-failure NDRs) is always skipped
   * regardless of this setting.
   */
  machineMail?: 'exclude' | 'include'
  /**
   * Content conditions, replaces the deleted "Message Filters" UI. Evaluated
   * by the engine with the shared `evaluateConditionsWithDiagnostics` against
   * message-resolvable fields (from/to/subject/body/hasAttachments).
   * Deliberately excludes `channel`/`isInbound`, channel scoping lives only
   * in `channelIds` above. Undefined/empty means "runs on every message".
   */
  conditions?: ConditionGroup[]
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
