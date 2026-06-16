// packages/lib/src/chat/agent/handoff.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'

const logger = createScopedLogger('chat-handoff')

/** Where a handoff originated, for audit/inbox context. */
export type HandoffSource = 'agent_tool' | 'procedure' | 'worker_failure'

/**
 * Flip a chat thread out of AI mode so it surfaces in the human queue, with
 * no forced assignee (unlike `takeOverThread`, which assigns the human who
 * clicked). The single flip + event site for every handoff origin
 * (plans/chat/v10 handoff-unify.md). Callers:
 *
 *   - the chat worker's terminal-failure path (engine exhausted its retries),
 *   - the post-turn applier in `process-chat-turn`, when the unified `handoff`
 *     tool fired (`source: 'agent_tool'`) or a procedure routed to handoff
 *     (`source: 'procedure'`).
 *
 * `reason` is the agent's free-text rationale (model-tool origin only; an
 * authored routing handoff has none). Idempotent — flipping an already-`'human'`
 * thread is a no-op write. Best effort: logs and swallows a missing-thread so a
 * worker failure handler can call it without a second failure mode.
 */
export async function flipHandoffState(
  args: {
    threadId: string
    organizationId: string
    reason?: string
    source?: HandoffSource
  },
  db: Database = database
): Promise<void> {
  const { threadId, organizationId, reason, source } = args
  const [updated] = await db
    .update(schema.Thread)
    .set({ handoffState: 'human', updatedAt: new Date() })
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .returning({ id: schema.Thread.id })

  if (!updated) {
    logger.warn('flipHandoffState: thread not found', { threadId, organizationId })
    return
  }
  logger.info('Chat thread handed off to human', { threadId, organizationId, source, reason })
}
