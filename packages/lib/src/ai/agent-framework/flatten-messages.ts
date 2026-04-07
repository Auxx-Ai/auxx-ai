// packages/lib/src/ai/agent-framework/flatten-messages.ts

import type { SessionMessage } from './types'

/**
 * Flatten conversation history for a model switch.
 *
 * Keeps only user messages and non-executor assistant messages with content.
 * Strips provider-specific artifacts (tool calls, reasoning, tool call IDs)
 * and re-links the parentId chain so messages form a contiguous sequence.
 */
export function flattenMessagesForModelSwitch(messages: SessionMessage[]): SessionMessage[] {
  const surviving = messages.filter((m) => {
    if (m.role === 'user') return true
    if (m.role === 'assistant' && m.metadata?.agent !== 'executor' && m.content?.trim()) {
      return true
    }
    return false
  })

  return surviving.map((m, i) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    parentId: i > 0 ? (surviving[i - 1]!.parentId ?? null) : null,
    metadata: m.metadata,
  }))
}

/**
 * Clean domain state fields that are stale after a model switch.
 * Removes approval/pending state that belonged to the previous model's session.
 */
export function cleanDomainStateForModelSwitch(
  domainState: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...domainState }
  delete cleaned._waitingForApproval
  delete cleaned._pendingToolCall
  delete cleaned._currentRoute
  return cleaned
}
