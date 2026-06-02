// packages/lib/src/chat/agent/handoff.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'

const logger = createScopedLogger('chat-handoff')

/**
 * Flip a chat thread out of AI mode so it surfaces in the human queue, with
 * no forced assignee (unlike `takeOverThread`, which assigns the human who
 * clicked). Shared by two callers (plans/chat/v5 phase-3b §6):
 *
 *   - the chat worker's terminal-failure path (engine exhausted its retries),
 *   - the `chat.handoff` escalation tool (phase 4b), when the agent decides a
 *     human should take over.
 *
 * Idempotent — flipping an already-`'human'` thread is a no-op write. Best
 * effort: logs and swallows a missing-thread so a worker failure handler can
 * call it without a second failure mode.
 */
export async function flipHandoffState(
  args: { threadId: string; organizationId: string },
  db: Database = database
): Promise<void> {
  const { threadId, organizationId } = args
  const [updated] = await db
    .update(schema.Thread)
    .set({ handoffState: 'human', updatedAt: new Date() })
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .returning({ id: schema.Thread.id })

  if (!updated) {
    logger.warn('flipHandoffState: thread not found', { threadId, organizationId })
    return
  }
  logger.info('Chat thread handed off to human', { threadId, organizationId })
}
