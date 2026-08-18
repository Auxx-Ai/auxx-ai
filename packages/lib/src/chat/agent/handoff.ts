// packages/lib/src/chat/agent/handoff.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { publisher } from '../../events/publisher'
import { createScopedLogger } from '../../logger'
import { type ThreadActor, threadActorToEventFields } from '../../thread-events/client'
import type { ChatThreadMetadata } from '../../threads/types'

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
 * authored routing handoff has none). `actor` attributes the emitted
 * `thread:taken_over` (thread-events §13.7): the agent flip passes
 * `{ kind: 'agent', id }`, the worker terminal-failure path `{ kind: 'system' }`.
 * Idempotent — flipping an already-`'human'` thread is a no-op write AND emits
 * nothing. Best effort: logs and swallows a missing-thread so a worker failure
 * handler can call it without a second failure mode.
 */
export async function flipHandoffState(
  args: {
    threadId: string
    organizationId: string
    reason?: string
    source?: HandoffSource
    actor?: ThreadActor
  },
  db: Database = database
): Promise<void> {
  const { threadId, organizationId, reason, source, actor } = args

  // Snapshot the pre-flip state so the emitted event carries `previousState`
  // (matching threads/handoff.service.ts) and a repeat flip stays silent.
  const [previous] = await db
    .select({ handoffState: schema.Thread.handoffState, metadata: schema.Thread.metadata })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)

  const [updated] = await db
    .update(schema.Thread)
    .set({ handoffState: 'human' })
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .returning({ id: schema.Thread.id })

  if (!updated) {
    logger.warn('flipHandoffState: thread not found', { threadId, organizationId })
    return
  }
  logger.info('Chat thread handed off to human', { threadId, organizationId, source, reason })

  // Emit AFTER the DB write, same payload shape as the human take-over path
  // (threads/handoff.service.ts) but with an `agent:`/system actor — the agent
  // flip previously wrote `handoffState` raw and emitted nothing (§13.7).
  if (previous?.handoffState === 'human') return
  const visitorParticipantId =
    ((previous?.metadata ?? {}) as Partial<ChatThreadMetadata>).visitorParticipantId ?? null
  await publisher.publishLater({
    type: 'thread:taken_over',
    data: {
      threadId: updated.id,
      organizationId,
      ...threadActorToEventFields(actor),
      previousState: previous?.handoffState ?? 'ai',
      visitorParticipantId,
    },
  })
}
