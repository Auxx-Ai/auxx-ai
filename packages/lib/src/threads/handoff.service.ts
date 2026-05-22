// packages/lib/src/threads/handoff.service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'

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

  logger.info('Thread returned to AI', { threadId, organizationId })

  return ok({
    threadId: updated.id,
    handoffState: updated.handoffState,
    assigneeId: updated.assigneeId,
  })
}
