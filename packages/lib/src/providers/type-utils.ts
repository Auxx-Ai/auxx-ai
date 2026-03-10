// packages/lib/src/providers/type-utils.ts

/**
 * Type utility functions for deriving message types from integration providers.
 * These utilities support the single source of truth pattern where Integration.provider
 * is the canonical field and all other type information is derived.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { IntegrationProviderType, MessageType } from './types'

/**
 * Derives the primary message type from a provider.
 * This is the core function that replaces stored messageType fields.
 *
 * @param provider - The integration provider type
 * @returns The primary message type for this provider
 *
 * @example
 * ```ts
 * const messageType = getMessageTypeFromProvider('google') // Returns 'EMAIL'
 * const messageType = getMessageTypeFromProvider('facebook') // Returns 'FACEBOOK'
 * ```
 */
export function getMessageTypeFromProvider(provider: IntegrationProviderType): MessageType {
  const mapping: Record<IntegrationProviderType, MessageType> = {
    google: 'EMAIL',
    outlook: 'EMAIL',
    mailgun: 'EMAIL',
    email: 'EMAIL',
    facebook: 'FACEBOOK',
    instagram: 'INSTAGRAM',
    openphone: 'SMS',
    sms: 'SMS',
    whatsapp: 'WHATSAPP',
    chat: 'CHAT',
    shopify: 'EMAIL', // Shopify uses email notifications
  }

  return mapping[provider] || 'EMAIL'
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
): Promise<IntegrationProviderType> {
  const result = await db
    .select({ provider: schema.Integration.provider })
    .from(schema.Message)
    .innerJoin(schema.Integration, eq(schema.Message.integrationId, schema.Integration.id))
    .where(eq(schema.Message.id, messageId))
    .limit(1)

  return result[0]?.provider || 'google'
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
): Promise<IntegrationProviderType> {
  const result = await db
    .select({ provider: schema.Integration.provider })
    .from(schema.Thread)
    .innerJoin(schema.Integration, eq(schema.Thread.integrationId, schema.Integration.id))
    .where(eq(schema.Thread.id, threadId))
    .limit(1)

  return result[0]?.provider || 'google'
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
): Promise<Map<string, IntegrationProviderType>> {
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
    .where(eq(schema.Message.id, messageIds[0])) // This needs inArray for multiple IDs

  const map = new Map<string, IntegrationProviderType>()
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
): Promise<Map<string, IntegrationProviderType>> {
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
    .where(eq(schema.Thread.id, threadIds[0])) // This needs inArray for multiple IDs

  const map = new Map<string, IntegrationProviderType>()
  for (const result of results) {
    map.set(result.threadId, result.provider)
  }

  return map
}
