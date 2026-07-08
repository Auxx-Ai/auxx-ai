// apps/web/src/components/workflow/nodes/core/message-received/trace-renderer.tsx

'use client'

import { ThreadListBlock } from '~/components/kopilot/ui/blocks/thread-list-block'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface MessageReceivedOutputs {
  messageId?: string
  subject?: string
  triggeredAt?: string
  threadId?: string
}

/**
 * Preview for Message Received trigger executions — the triggering thread,
 * so a reviewer can see "what fired this run" at a glance. Legacy runs
 * persisted before `threadId` was added to this node's output fall back to
 * raw JSON.
 */
export function MessageReceivedTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as MessageReceivedOutputs

  if (!outputs.threadId) {
    return <TraceRawJson value={execution.outputs} />
  }

  return <ThreadListBlock data={{ threadIds: [outputs.threadId] }} skipEntrance />
}
