// packages/lib/src/providers/type-utils.ts

/**
 * Type utility functions for deriving a message type DEFAULT from an integration
 * provider. `Integration.provider` remains the canonical field for brand/channel
 * questions (see `ChannelGroup`), but `Message.messageType` is now its own stored
 * column (message-type-overhaul plan §2.7/§3) — a call and a text can arrive on
 * the SAME Integration, so the type can no longer be a pure function of provider.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq, inArray } from 'drizzle-orm'
import { ChannelProviderType, MessageType } from './types'

/**
 * Returns the DEFAULT message type a provider's messages are stamped with at
 * write time — not a derived authority read back on every query.
 *
 * `Message.messageType` is a stored, `NOT NULL` column. Ingest calls this only
 * as a fallback when a provider mapper does not supply a more specific value
 * (`ingest/store-message.ts`), and the composer calls it to stamp an outbound
 * row (`messages/message-composer.service.ts`). For every provider except
 * `openphone` today, the default IS the only value that provider ever produces
 * — but a provider mapper that can distinguish per-message (e.g. openphone
 * telling a call from a text) is expected to set `MessageData.messageType`
 * explicitly rather than rely on this.
 *
 * @param provider - The integration provider type
 * @returns The default message type for this provider
 *
 * @example
 * ```ts
 * const messageType = getMessageTypeFromProvider('google') // Returns 'EMAIL'
 * const messageType = getMessageTypeFromProvider('facebook') // Returns 'CHAT'
 * ```
 */
export function getMessageTypeFromProvider(provider: ChannelProviderType): MessageType {
  const mapping: Record<ChannelProviderType, MessageType> = {
    google: MessageType.EMAIL,
    outlook: MessageType.EMAIL,
    mailgun: MessageType.EMAIL,
    email: MessageType.EMAIL,
    imap: MessageType.EMAIL,
    facebook: MessageType.CHAT,
    instagram: MessageType.CHAT,
    openphone: MessageType.SMS,
    sms: MessageType.SMS,
    whatsapp: MessageType.CHAT,
    chat: MessageType.CHAT,
    shopify: MessageType.EMAIL, // Shopify uses email notifications
  }

  return mapping[provider] || MessageType.EMAIL
}

/**
 * Get the provider type for a specific message by querying the database.
 * This performs a JOIN with the Integration table.
 *
 * @param messageId - The message ID
 * @param db - Database instance
 * @returns The provider type for this message
 *
 * @example
 * ```ts
 * const provider = await getProviderForMessage('msg_123', ctx.db)
 * const messageType = getMessageTypeFromProvider(provider)
 * ```
 */
export async function getProviderForMessage(
  messageId: string,
  db: Database
): Promise<ChannelProviderType> {
  const result = await db
    .select({ provider: schema.Integration.provider })
    .from(schema.Message)
    .innerJoin(schema.Integration, eq(schema.Message.integrationId, schema.Integration.id))
    .where(eq(schema.Message.id, messageId))
    .limit(1)

  return result[0]?.provider ?? ChannelProviderType.google
}

/**
 * Get the provider type for a specific thread by querying the database.
 * This performs a JOIN with the Integration table.
 *
 * @param threadId - The thread ID
 * @param db - Database instance
 * @returns The provider type for this thread
 *
 * @example
 * ```ts
 * const provider = await getProviderForThread('thread_123', ctx.db)
 * const messageType = getMessageTypeFromProvider(provider)
 * ```
 */
export async function getProviderForThread(
  threadId: string,
  db: Database
): Promise<ChannelProviderType> {
  const result = await db
    .select({ provider: schema.Integration.provider })
    .from(schema.Thread)
    .innerJoin(schema.Integration, eq(schema.Thread.integrationId, schema.Integration.id))
    .where(eq(schema.Thread.id, threadId))
    .limit(1)

  return result[0]?.provider ?? ChannelProviderType.google
}

/**
 * Batch get providers for multiple messages.
 * More efficient than calling getProviderForMessage multiple times.
 *
 * @param messageIds - Array of message IDs
 * @param db - Database instance
 * @returns Map of message ID to provider type
 *
 * @example
 * ```ts
 * const providers = await getProvidersForMessages(['msg_1', 'msg_2'], ctx.db)
 * const provider1 = providers.get('msg_1')
 * ```
 */
export async function getProvidersForMessages(
  messageIds: string[],
  db: Database
): Promise<Map<string, ChannelProviderType>> {
  if (messageIds.length === 0) {
    return new Map()
  }

  const results = await db
    .select({
      messageId: schema.Message.id,
      provider: schema.Integration.provider,
    })
    .from(schema.Message)
    .innerJoin(schema.Integration, eq(schema.Message.integrationId, schema.Integration.id))
    .where(inArray(schema.Message.id, messageIds))

  const map = new Map<string, ChannelProviderType>()
  for (const result of results) {
    map.set(result.messageId, result.provider)
  }

  return map
}

/**
 * Batch get providers for multiple threads.
 * More efficient than calling getProviderForThread multiple times.
 *
 * @param threadIds - Array of thread IDs
 * @param db - Database instance
 * @returns Map of thread ID to provider type
 *
 * @example
 * ```ts
 * const providers = await getProvidersForThreads(['thread_1', 'thread_2'], ctx.db)
 * const provider1 = providers.get('thread_1')
 * ```
 */
export async function getProvidersForThreads(
  threadIds: string[],
  db: Database
): Promise<Map<string, ChannelProviderType>> {
  if (threadIds.length === 0) {
    return new Map()
  }

  const results = await db
    .select({
      threadId: schema.Thread.id,
      provider: schema.Integration.provider,
    })
    .from(schema.Thread)
    .innerJoin(schema.Integration, eq(schema.Thread.integrationId, schema.Integration.id))
    .where(inArray(schema.Thread.id, threadIds))

  const map = new Map<string, ChannelProviderType>()
  for (const result of results) {
    map.set(result.threadId, result.provider)
  }

  return map
}
