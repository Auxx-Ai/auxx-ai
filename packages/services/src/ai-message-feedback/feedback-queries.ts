// packages/services/src/ai-message-feedback/feedback-queries.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { GetSessionFeedbackInput, UpsertMessageFeedbackInput } from './types'

/**
 * Upsert message feedback (insert or update). When isPositive is null, deletes the row.
 */
export async function upsertMessageFeedback(input: UpsertMessageFeedbackInput) {
  const { sessionId, messageId, isPositive, organizationId, userId } = input

  // Delete feedback
  if (isPositive === null) {
    const result = await fromDatabase(
      database
        .delete(schema.AiMessageFeedback)
        .where(
          and(
            eq(schema.AiMessageFeedback.sessionId, sessionId),
            eq(schema.AiMessageFeedback.messageId, messageId),
            eq(schema.AiMessageFeedback.userId, userId)
          )
        ),
      'delete-ai-message-feedback'
    )
    if (result.isErr()) return err(result.error)
    return ok(undefined)
  }

  // Upsert feedback
  const result = await fromDatabase(
    database
      .insert(schema.AiMessageFeedback)
      .values({ sessionId, messageId, isPositive, organizationId, userId })
      .onConflictDoUpdate({
        target: [
          schema.AiMessageFeedback.sessionId,
          schema.AiMessageFeedback.messageId,
          schema.AiMessageFeedback.userId,
        ],
        set: { isPositive },
      }),
    'upsert-ai-message-feedback'
  )

  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

/**
 * Load all feedback for a session.
 */
export async function getSessionFeedback(input: GetSessionFeedbackInput) {
  const { sessionId, organizationId } = input

  const result = await fromDatabase(
    database
      .select()
      .from(schema.AiMessageFeedback)
      .where(
        and(
          eq(schema.AiMessageFeedback.sessionId, sessionId),
          eq(schema.AiMessageFeedback.organizationId, organizationId)
        )
      ),
    'get-session-feedback'
  )

  if (result.isErr()) return err(result.error)
  return ok(result.value)
}
