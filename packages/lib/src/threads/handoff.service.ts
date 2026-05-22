// packages/lib/src/threads/handoff.service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { publisher } from '../events/publisher'

const logger = createScopedLogger('thread-handoff')

interface TakeOverParams {
  db: Database
  threadId: string
  organizationId: string
  /** New assignee (the human "taking over"). */
  userId: string
}

interface ReturnToAiParams {
  db: Database
  threadId: string
  organizationId: string
  /** The user handing the thread back to the AI agent. */
  userId: string
}

interface HandoffResult {
  threadId: string
  handoffState: 'ai' | 'human'
  assigneeId: string | null
}

/**
 * Flip a chat thread to human-driven mode. Assigns the caller AND sets
 * `handoffState = 'human'` in a single UPDATE so the AI gate sees a consistent
 * snapshot. Does NOT publish thread events — that's wired in P4.3.
 */
export const takeOverThread = async ({
  db,
  threadId,
  organizationId,
  userId,
}: TakeOverParams): Promise<Result<HandoffResult, NotFoundError>> => {
  // Snapshot pre-update state so the emitted event carries `previousState`
  // (and so an assignee-changed event fires only when the assignee actually
  // moved).
  const [previous] = await db
    .select({
      handoffState: schema.Thread.handoffState,
      assigneeId: schema.Thread.assigneeId,
    })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)

  const [updated] = await db
    .update(schema.Thread)
    .set({ assigneeId: userId, handoffState: 'human' })
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .returning({
      id: schema.Thread.id,
      handoffState: schema.Thread.handoffState,
      assigneeId: schema.Thread.assigneeId,
    })

  if (!updated) {
    return err(new NotFoundError(`Thread ${threadId} not found`))
  }

  logger.info('Thread taken over by human', { threadId, organizationId, userId })

  await publisher.publishLater({
    type: 'thread:taken_over',
    data: {
      threadId: updated.id,
      organizationId,
      userId,
      previousState: previous?.handoffState ?? 'ai',
    },
  })

  // Fan out a separate assignee-changed event when the assignee actually moved
  // — keeps the assignee timeline complete without conflating it with the
  // handoff event (consumers can subscribe to one without the other).
  const previousAssigneeId = previous?.assigneeId ?? null
  if (previousAssigneeId !== userId) {
    await publisher.publishLater({
      type: 'thread:assignee:changed',
      data: {
        threadId: updated.id,
        organizationId,
        fromUserId: previousAssigneeId,
        toUserId: userId,
      },
    })
  }

  return ok({
    threadId: updated.id,
    handoffState: updated.handoffState,
    assigneeId: updated.assigneeId,
  })
}

/**
 * Hand the thread back to the AI agent. Leaves `assigneeId` set so the audit
 * trail of "last human to touch this" is preserved (per plan). Does NOT
 * publish thread events — that's wired in P4.3.
 */
export const returnThreadToAi = async ({
  db,
  threadId,
  organizationId,
  userId,
}: ReturnToAiParams): Promise<Result<HandoffResult, NotFoundError>> => {
  const [updated] = await db
    .update(schema.Thread)
    .set({ handoffState: 'ai' })
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .returning({
      id: schema.Thread.id,
      handoffState: schema.Thread.handoffState,
      assigneeId: schema.Thread.assigneeId,
    })

  if (!updated) {
    return err(new NotFoundError(`Thread ${threadId} not found`))
  }

  logger.info('Thread returned to AI', { threadId, organizationId, userId })

  await publisher.publishLater({
    type: 'thread:returned_to_ai',
    data: {
      threadId: updated.id,
      organizationId,
      userId,
    },
  })

  return ok({
    threadId: updated.id,
    handoffState: updated.handoffState,
    assigneeId: updated.assigneeId,
  })
}
