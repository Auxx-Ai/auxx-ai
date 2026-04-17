// packages/lib/src/ingest/reconciliation/reconcile-message.ts

import { schema } from '@auxx/database'
import type { MessageEntity as Message } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { IngestContext } from '../context'
import type { MessageData } from '../types'
import { extractInternetMessageId } from './extract-internet-message-id'
import { isSimilarSubject } from './is-similar-subject'
import { mergeProviderData } from './merge-provider-data'

/**
 * Reconcile a provider-sourced MessageData with any existing row that should
 * be treated as the same message. Prefers the dedicated reconciler service;
 * falls back to a legacy chain of externalId / Message-ID / heuristic matching.
 *
 * Returns the existing row (with provider fields merged) or null when no
 * match was found.
 */
export async function reconcileMessage(
  ctx: IngestContext,
  messageData: MessageData
): Promise<Message | null> {
  const result = await ctx.reconciler.reconcileIncomingSync(messageData)

  if (result.isReconciled && result.existingMessageId) {
    const [message] = await ctx.db
      .select()
      .from(schema.Message)
      .where(eq(schema.Message.id, result.existingMessageId))
      .limit(1)

    if (message) {
      ctx.logger.debug('Message reconciled by MessageReconcilerService', {
        messageId: message.id,
        externalId: messageData.externalId,
      })
      return message
    }
    return null
  }

  if (messageData.externalId && messageData.integrationId) {
    try {
      const [existing] = await ctx.db
        .select()
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.integrationId, messageData.integrationId),
            eq(schema.Message.externalId, messageData.externalId)
          )
        )
        .limit(1)
      if (existing) {
        ctx.logger.debug('Message reconciled by externalId (legacy)', {
          messageId: existing.id,
          externalId: messageData.externalId,
        })
        return await mergeProviderData(ctx, existing, messageData)
      }
    } catch (error) {
      ctx.logger.error('Error checking externalId match', { error })
    }
  }

  const internetMessageId = extractInternetMessageId(messageData)
  if (internetMessageId && messageData.organizationId) {
    try {
      const [existing] = await ctx.db
        .select()
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.organizationId, messageData.organizationId),
            eq(schema.Message.internetMessageId, internetMessageId)
          )
        )
        .limit(1)
      if (existing) {
        ctx.logger.debug('Message reconciled by internetMessageId (legacy)', {
          messageId: existing.id,
          internetMessageId,
        })
        return await mergeProviderData(ctx, existing, messageData)
      }
    } catch (error) {
      ctx.logger.error('Error checking internetMessageId match', { error })
    }
  }

  if (messageData.externalThreadId && messageData.sentAt && messageData.from?.identifier) {
    try {
      const [thread] = await ctx.db
        .select()
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.integrationId, messageData.integrationId),
            eq(schema.Thread.externalId, messageData.externalThreadId)
          )
        )
        .limit(1)

      if (thread) {
        const timeWindowStart = new Date(messageData.sentAt.getTime() - 2 * 60 * 1000)
        const timeWindowEnd = new Date(messageData.sentAt.getTime() + 2 * 60 * 1000)

        const candidates = await ctx.db.query.Message.findMany({
          where: (t, { and: andF, eq: eqF, gte, lte }) =>
            andF(
              eqF(t.threadId, thread.id),
              gte(t.sentAt, timeWindowStart as any),
              lte(t.sentAt, timeWindowEnd as any)
            ),
          with: { from: true },
        })

        const match = candidates.find((c) => {
          const senderMatch = c.from?.identifier === messageData.from.identifier
          const subjectMatch = isSimilarSubject(c.subject, messageData.subject)
          return senderMatch && subjectMatch
        })

        if (match) {
          ctx.logger.debug('Message reconciled by heuristic match (legacy)', {
            messageId: match.id,
            threadId: thread.id,
            subject: messageData.subject,
          })
          return await mergeProviderData(ctx, match, messageData)
        }
      }
    } catch (error) {
      ctx.logger.error('Error checking heuristic match', { error })
    }
  }

  return null
}
