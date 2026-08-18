// packages/lib/src/ingest/filtering/store-ignored.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import { sql } from 'drizzle-orm'
import { getMessageTypeFromProvider } from '../../providers/type-utils'
import { type ChannelProviderType, MessageType } from '../../providers/types'
import type { IngestContext } from '../context'
import { findOrCreateParticipantRecord } from '../participants/find-or-create'
import { determineIdentifierType } from '../participants/normalize'
import { defaultThreadSubject } from '../threads/default-subject'
import type { MessageData } from '../types'

/**
 * Insert a minimal Thread + Message pair purely for dedup purposes.
 * No contacts, body, attachments, recipients, or events — the message was
 * matched by an ignore rule, we only need enough shape to keep future sync
 * idempotent.
 *
 * The sender Participant is the one exception: `Message.fromId` is NOT NULL
 * with an FK to `Participant`, so the row cannot exist without it. Contact
 * creation is explicitly suppressed, so an ignored sender still never enters
 * the contact graph.
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
      subject: defaultThreadSubject(
        messageData.subject,
        ctx.providerByIntegrationId.get(messageData.integrationId)
      ),
      status: ThreadStatus.IGNORED,
      firstMessageAt: messageData.sentAt,
      lastMessageAt: messageData.sentAt,
      messageCount: 1,
      participantCount: 0,
    })
    .onConflictDoUpdate({
      // Nothing to change on a hit — we only need `RETURNING` to yield the
      // existing row's id (DO NOTHING returns none). Drizzle rejects an empty
      // `set`, so assign the conflict-target column to itself: `excluded` holds
      // the same value the matched row already has, making this a no-op write.
      target: [schema.Thread.integrationId, schema.Thread.externalId],
      set: { externalId: sql`excluded."externalId"` },
    })
    .returning({ id: schema.Thread.id })

  if (!thread) {
    throw new Error(
      `Ignored-message thread upsert returned no row for externalThreadId ${messageData.externalThreadId} (integration ${messageData.integrationId})`
    )
  }

  const senderIdentifierType = await determineIdentifierType(
    ctx,
    messageData.from.identifier,
    messageData.integrationId
  )
  const sender = await findOrCreateParticipantRecord(
    ctx,
    messageData.from,
    senderIdentifierType,
    // No messageContext: an ignored message must not move interaction state.
    undefined,
    null,
    true
  )

  // Same fallback as `storeMessage`: a mapper-supplied value wins, otherwise the
  // provider's default form; an integration that vanished by ingest time
  // (soft-deleted) falls back to EMAIL rather than being cast through the map.
  const ignoredProvider = ctx.providerByIntegrationId.get(messageData.integrationId)
  const messageType =
    messageData.messageType ??
    (ignoredProvider
      ? getMessageTypeFromProvider(ignoredProvider as ChannelProviderType)
      : MessageType.EMAIL)

  const [message] = await ctx.db
    .insert(schema.Message)
    .values({
      externalId: messageData.externalId,
      fromId: sender.id,
      externalThreadId: messageData.externalThreadId,
      threadId: thread.id,
      organizationId: messageData.organizationId,
      integrationId: messageData.integrationId,
      messageType,
      internetMessageId: messageData.internetMessageId,
      // Both are NOT NULL with no column default — omitting them makes Postgres
      // reject the row outright. Mirrors `storeMessage`'s insert.
      createdAt: messageData.createdTime,
      updatedAt: new Date(),
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
