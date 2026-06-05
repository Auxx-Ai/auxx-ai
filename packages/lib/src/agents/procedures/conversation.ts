// packages/lib/src/agents/procedures/conversation.ts

import type { SessionMessage } from '../../ai/agent-framework/types'
import type { ConversationMessage } from './classify'

/** Best-effort plain text for a session message (string `content` or joined text parts). */
function extractMessageText(m: SessionMessage): string {
  const content = (m as { content?: unknown }).content
  if (typeof content === 'string') return content
  const parts = (m as { parts?: unknown }).parts
  if (Array.isArray(parts)) {
    return parts
      .filter(
        (p): p is { type: 'text'; text: string } =>
          typeof p === 'object' &&
          p !== null &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string'
      )
      .map((p) => p.text)
      .join('')
  }
  return ''
}

/**
 * Flatten session messages into the `{ role, content }` view the procedure
 * classifier / selection reads. Drops non-user/assistant turns and empties.
 * Shared by both turn processors (chat + internal agent job).
 */
export function sessionMessagesToConversation(messages: SessionMessage[]): ConversationMessage[] {
  const out: ConversationMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const content = extractMessageText(m)
    if (content.trim()) out.push({ role: m.role, content })
  }
  return out
}
