// packages/lib/src/ai/agent-framework/sessions/catchup-replay.ts

import { database, schema } from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, asc, eq } from 'drizzle-orm'
import type { SessionMessage } from '../types'

export interface CatchupReplayInput {
  organizationId: string
  threadId: string
  /** The session's current `messages` array — used to skip already-recorded turns. */
  existingMessages: SessionMessage[]
  /** The answering agent's backing User id — distinguishes agent replies from teammate replies. */
  agentUserId: string
  /**
   * The triggering inbound message. Excluded from the replay because the
   * engine appends it itself via `submitMessage(inboundText)`; replaying it
   * here would double-count it.
   */
  excludeMessageId: string
}

/**
 * Build the `SessionMessage`s for any `Message` rows on a chat thread that the
 * session hasn't recorded yet, so a turn replays history transparently —
 * covering human takeover, the human-replies-then-returns case, and multiple
 * visitor messages that arrived while a turn was in flight (all the same way).
 *
 * Mapping (locked, no schema change — `SessionMessage` roles are a closed
 * union `'user' | 'system' | 'assistant'`):
 *   - inbound (visitor)            → `role: 'user'`
 *   - outbound by the agent's User → `role: 'assistant'`
 *   - outbound by a teammate       → `role: 'system'`, content
 *     `Teammate replied to the visitor: "<text>"`, metadata tagged
 *     `{ sender: 'human-teammate', messageId }` so the LLM reads it as
 *     context, not its own prior output.
 *
 * Every produced message carries `metadata.messageId` so a later turn's replay
 * skips it (idempotent across retries / multiple turns).
 *
 * Returns the new messages in chronological order; the caller concatenates
 * them onto the session's existing messages before running the engine.
 */
export async function buildCatchupMessages(input: CatchupReplayInput): Promise<SessionMessage[]> {
  const { organizationId, threadId, existingMessages, agentUserId, excludeMessageId } = input

  const seen = new Set<string>()
  for (const m of existingMessages) {
    const id = m.metadata?.messageId
    if (typeof id === 'string') seen.add(id)
  }

  const rows = await database
    .select({
      id: schema.Message.id,
      isInbound: schema.Message.isInbound,
      createdById: schema.Message.createdById,
      textPlain: schema.Message.textPlain,
      createdAt: schema.Message.createdAt,
    })
    .from(schema.Message)
    .where(
      and(eq(schema.Message.threadId, threadId), eq(schema.Message.organizationId, organizationId))
    )
    .orderBy(asc(schema.Message.createdAt))

  const out: SessionMessage[] = []
  for (const row of rows) {
    if (row.id === excludeMessageId || seen.has(row.id)) continue
    const text = (row.textPlain ?? '').trim()
    if (!text) continue
    const timestamp = row.createdAt.getTime()

    if (row.isInbound) {
      out.push({
        id: generateId(),
        role: 'user',
        content: text,
        timestamp,
        metadata: { messageId: row.id },
      })
    } else if (row.createdById === agentUserId) {
      out.push({
        id: generateId(),
        role: 'assistant',
        parts: [{ type: 'text', text }],
        timestamp,
        metadata: { messageId: row.id },
      })
    } else {
      out.push({
        id: generateId(),
        role: 'system',
        content: `Teammate replied to the visitor: "${text}"`,
        timestamp,
        metadata: { sender: 'human-teammate', messageId: row.id },
      })
    }
  }

  return out
}
