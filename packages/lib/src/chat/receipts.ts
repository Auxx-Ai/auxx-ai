// packages/lib/src/chat/receipts.ts

import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getRealtimeService } from '../realtime'
import { Result, type TypedResult } from '../result'
import { publishChatMessageReceiptUpdated } from './realtime'
import type { ServiceContext } from './types'

/**
 * Mark a set of agent → visitor messages as delivered by the visitor.
 *
 * `messageIds` are filtered to AGENT-sent rows for the visitor's chat thread —
 * VISITOR-sent rows don't have receipts (the visitor is the sender, not the
 * recipient). Publishes `message:updated` so agent UIs reflect the change.
 */
export async function markDelivered(
  ctx: ServiceContext,
  visitorParticipantId: string,
  messageIds: string[]
): Promise<TypedResult<{ updated: number }, Error>> {
  return updateReceipts(ctx, visitorParticipantId, messageIds, 'delivered')
}

/** Same as {@link markDelivered}, but flips `readAt`. */
export async function markRead(
  ctx: ServiceContext,
  visitorParticipantId: string,
  messageIds: string[]
): Promise<TypedResult<{ updated: number }, Error>> {
  return updateReceipts(ctx, visitorParticipantId, messageIds, 'read')
}

async function updateReceipts(
  ctx: ServiceContext,
  visitorParticipantId: string,
  messageIds: string[],
  kind: 'delivered' | 'read'
): Promise<TypedResult<{ updated: number }, Error>> {
  if (messageIds.length === 0) return Result.ok({ updated: 0 })

  try {
    const now = new Date()
    const patch = kind === 'delivered' ? { deliveredAt: now } : { readAt: now }

    const updated = await ctx.db
      .update(schema.MessageReceipt)
      .set({ ...patch, updatedAt: now })
      .where(
        and(
          eq(schema.MessageReceipt.recipientParticipantId, visitorParticipantId),
          inArray(schema.MessageReceipt.messageId, messageIds)
        )
      )
      .returning({
        id: schema.MessageReceipt.id,
        messageId: schema.MessageReceipt.messageId,
      })

    if (updated.length === 0) return Result.ok({ updated: 0 })

    const messageRows = await ctx.db
      .select({
        id: schema.Message.id,
        threadId: schema.Message.threadId,
        inboxId: schema.Thread.inboxId,
      })
      .from(schema.Message)
      .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
      .where(
        inArray(
          schema.Message.id,
          updated.map((u) => u.messageId)
        )
      )

    await Promise.all(
      messageRows.map((m) =>
        publishChatMessageReceiptUpdated(getRealtimeService(), {
          organizationId: ctx.organizationId,
          inboxId: m.inboxId,
          messageId: m.id,
          threadId: m.threadId,
          patch,
        })
      )
    )

    return Result.ok({ updated: updated.length })
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error(String(error)))
  }
}
