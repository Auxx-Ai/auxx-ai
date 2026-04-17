// packages/lib/src/ingest/filtering/store-ignored.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import type { IngestContext } from '../context'
import type { MessageData } from '../types'

/**
 * Insert a minimal Thread + Message pair purely for dedup purposes.
 * No participants, contacts, body, or attachments — the message was matched
 * by an ignore rule, we only need enough shape to keep future sync idempotent.
 */
export async function storeIgnoredMessage(
  ctx: IngestContext,
  messageData: MessageData
): Promise<{ messageId: string; isNew: boolean }> {
  const [thread] = await ctx.db
    .insert(schema.Thread)
    .values({
      externalId: messageData.externalThreadId,
      integrationId: messageData.integrationId,
      organizationId: messageData.organizationId,
      subject: messageData.subject ?? 'No Subject',
      status: ThreadStatus.IGNORED,
      firstMessageAt: messageData.sentAt,
      lastMessageAt: messageData.sentAt,
      messageCount: 1,
      participantCount: 0,
    })
    .onConflictDoUpdate({
      target: [schema.Thread.integrationId, schema.Thread.externalId],
      set: {},
    })
    .returning({ id: schema.Thread.id })

  const [message] = await ctx.db
    .insert(schema.Message)
    .values({
      externalId: messageData.externalId,
      externalThreadId: messageData.externalThreadId,
      threadId: thread.id,
      organizationId: messageData.organizationId,
      integrationId: messageData.integrationId,
      internetMessageId: messageData.internetMessageId,
      sentAt: messageData.sentAt,
      receivedAt: messageData.receivedAt,
      subject: messageData.subject ?? '',
      isInbound: messageData.isInbound,
    })
    .onConflictDoNothing({
      target: [schema.Message.integrationId, schema.Message.externalId],
    })
    .returning({ id: schema.Message.id })

  ctx.logger.info('Stored ignored message (minimal, no body/contacts)', {
    messageId: message?.id,
    externalId: messageData.externalId,
    threadId: thread.id,
  })

  return { messageId: message?.id ?? '', isNew: !!message }
}
