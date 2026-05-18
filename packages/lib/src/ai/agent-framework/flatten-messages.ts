// packages/lib/src/ai/agent-framework/flatten-messages.ts

import { generateId } from '@auxx/utils/generateId'
import type { AssistantSessionMessage, ContentPart, SessionMessage } from './types'

/**
 * Project the text content out of an assistant message's parts. Tool calls
 * and thinking are turn-specific and don't survive a context reset.
 */
function partsToFlatText(parts: ContentPart[] | undefined): string {
  if (!parts) return ''
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
}

/**
 * Flatten conversation history for a model switch.
 *
 * Keeps user messages and any assistant message that produced final prose
 * (non-empty text projection). Strips tool calls, thinking, and reasoning —
 * the new model starts fresh on those.
 */
export function flattenMessagesForModelSwitch(messages: SessionMessage[]): SessionMessage[] {
  const surviving = messages.filter((m) => {
    if (m.role === 'user') return true
    if (m.role === 'assistant')
      return partsToFlatText((m as AssistantSessionMessage).parts).length > 0
    return false
  })

  return surviving.map((m, i) => {
    if (m.role === 'user') {
      return {
        id: m.id,
        role: 'user' as const,
        content: m.content,
        timestamp: m.timestamp,
        parentId: i > 0 ? (surviving[i - 1]!.parentId ?? null) : null,
        metadata: m.metadata,
      }
    }
    // assistant
    const a = m as AssistantSessionMessage
    return {
      id: a.id ?? generateId('msg'),
      role: 'assistant' as const,
      v: 1 as const,
      parts: [{ type: 'text' as const, text: partsToFlatText(a.parts) }],
      timestamp: a.timestamp,
      parentId: i > 0 ? (surviving[i - 1]!.parentId ?? null) : null,
      metadata: a.metadata,
    }
  })
}

/**
 * Clean domain state fields that are stale after a model switch.
 * `_waitingForApproval` / `_pendingToolCall` don't survive into the new model
 * (the paused message itself does, with its `awaiting-approval` part — the
 * new model can decide what to do). `_currentRoute` is turn-specific.
 */
export function cleanDomainStateForModelSwitch(
  domainState: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...domainState }
  delete cleaned._currentRoute
  return cleaned
}
