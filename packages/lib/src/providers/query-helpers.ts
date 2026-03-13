// packages/lib/src/providers/query-helpers.ts

/**
 * Query helper functions for filtering by provider and derived message types.
 * These helpers replace direct column filtering on removed integrationType/messageType fields.
 */

import { schema } from '@auxx/database'
import { and, eq, exists, inArray, isNull, type SQL } from 'drizzle-orm'
import type { IntegrationProviderType, MessageType } from './types'

/**
 * Filter threads by provider type.
 * Use this instead of filtering on the removed Thread.integrationType field.
 *
 * Uses an EXISTS subquery to check the Integration table without requiring a JOIN.
 *
 * @param provider - Single provider or array of providers to filter by
 * @returns SQL condition for WHERE clause
 *
 * @example
 * ```ts
 * // Single provider
 * const threads = await db.query.Thread.findMany({
 *   where: whereThreadProvider('google')
 * })
 *
 * // Multiple providers
 * const emailThreads = await db.query.Thread.findMany({
 *   where: whereThreadProvider(['google', 'outlook', 'mailgun'])
 * })
 * ```
 */
export function whereThreadProvider(
  provider: IntegrationProviderType | IntegrationProviderType[]
): SQL {
  const providers = Array.isArray(provider) ? provider : [provider]

  return exists(
    schema.Integration,
    and(
      eq(schema.Integration.id, schema.Thread.integrationId),
      inArray(schema.Integration.provider, providers),
      isNull(schema.Integration.deletedAt)
    )
  )
}

/**
 * Filter messages by provider type.
 * Use this instead of filtering on the removed Message.integrationType field.
 *
 * Uses an EXISTS subquery to check the Integration table without requiring a JOIN.
 *
 * @param provider - Single provider or array of providers to filter by
 * @returns SQL condition for WHERE clause
 *
 * @example
 * ```ts
 * const messages = await db.query.Message.findMany({
 *   where: whereMessageProvider('google')
 * })
 * ```
 */
export function whereMessageProvider(
  provider: IntegrationProviderType | IntegrationProviderType[]
): SQL {
  const providers = Array.isArray(provider) ? provider : [provider]

  return exists(
    schema.Integration,
    and(
      eq(schema.Integration.id, schema.Message.integrationId),
      inArray(schema.Integration.provider, providers),
      isNull(schema.Integration.deletedAt)
    )
  )
}

/**
 * Filter threads by message type (derived from provider).
 * Use this instead of filtering on the removed Thread.messageType field.
 *
 * This function maps message types to their corresponding providers and filters accordingly.
 * Uses an EXISTS subquery to check the Integration table without requiring a JOIN.
 *
 * @param messageType - Single message type or array of message types to filter by
 * @returns SQL condition for WHERE clause
 *
 * @example
 * ```ts
 * // Get all email threads (from any email provider)
 * const emailThreads = await db.query.Thread.findMany({
 *   where: whereThreadMessageType('EMAIL')
 * })
 *
 * // Get social media threads
 * const socialThreads = await db.query.Thread.findMany({
 *   where: whereThreadMessageType(['FACEBOOK', 'INSTAGRAM'])
 * })
 * ```
 */
export function whereThreadMessageType(messageType: MessageType | MessageType[]): SQL {
  const types = Array.isArray(messageType) ? messageType : [messageType]

  // Map message types to providers
  const providers: IntegrationProviderType[] = []

  for (const type of types) {
    switch (type) {
      case 'EMAIL':
        providers.push('google', 'outlook', 'mailgun', 'email')
        break
      case 'FACEBOOK':
        providers.push('facebook')
        break
      case 'INSTAGRAM':
        providers.push('instagram')
        break
      case 'SMS':
        providers.push('openphone', 'sms')
        break
      case 'WHATSAPP':
        providers.push('whatsapp')
        break
      case 'CHAT':
        providers.push('chat')
        break
      case 'CALL':
        providers.push('openphone')
        break
    }
  }

  // Remove duplicates
  const uniqueProviders = [...new Set(providers)]

  return exists(
    schema.Integration,
    and(
      eq(schema.Integration.id, schema.Thread.integrationId),
      inArray(schema.Integration.provider, uniqueProviders),
      isNull(schema.Integration.deletedAt)
    )
  )
}

/**
 * Filter messages by message type (derived from provider).
 * Use this instead of filtering on the removed Message.messageType field.
 *
 * Uses an EXISTS subquery to check the Integration table without requiring a JOIN.
 *
 * @param messageType - Single message type or array of message types to filter by
 * @returns SQL condition for WHERE clause
 *
 * @example
 * ```ts
 * const emailMessages = await db.query.Message.findMany({
 *   where: whereMessageMessageType('EMAIL')
 * })
 * ```
 */
export function whereMessageMessageType(messageType: MessageType | MessageType[]): SQL {
  const types = Array.isArray(messageType) ? messageType : [messageType]

  // Map message types to providers
  const providers: IntegrationProviderType[] = []

  for (const type of types) {
    switch (type) {
      case 'EMAIL':
        providers.push('google', 'outlook', 'mailgun', 'email')
        break
      case 'FACEBOOK':
        providers.push('facebook')
        break
      case 'INSTAGRAM':
        providers.push('instagram')
        break
      case 'SMS':
        providers.push('openphone', 'sms')
        break
      case 'WHATSAPP':
        providers.push('whatsapp')
        break
      case 'CHAT':
        providers.push('chat')
        break
      case 'CALL':
        providers.push('openphone')
        break
    }
  }

  // Remove duplicates
  const uniqueProviders = [...new Set(providers)]

  return exists(
    schema.Integration,
    and(
      eq(schema.Integration.id, schema.Message.integrationId),
      inArray(schema.Integration.provider, uniqueProviders),
      isNull(schema.Integration.deletedAt)
    )
  )
}

/**
 * Helper to get all email providers.
 * Useful for common filtering scenarios.
 *
 * @returns Array of email provider types
 *
 * @example
 * ```ts
 * const emailProviders = getEmailProviders()
 * const emailThreads = await db.query.Thread.findMany({
 *   with: { integration: true },
 *   where: whereThreadProvider(emailProviders)
 * })
 * ```
 */
export function getEmailProviders(): IntegrationProviderType[] {
  return ['google', 'outlook', 'mailgun', 'email']
}

/**
 * Helper to get all social media providers.
 * Useful for common filtering scenarios.
 *
 * @returns Array of social media provider types
 *
 * @example
 * ```ts
 * const socialProviders = getSocialProviders()
 * const socialThreads = await db.query.Thread.findMany({
 *   with: { integration: true },
 *   where: whereThreadProvider(socialProviders)
 * })
 * ```
 */
export function getSocialProviders(): IntegrationProviderType[] {
  return ['facebook', 'instagram']
}

/**
 * Helper to get all SMS providers.
 * Useful for common filtering scenarios.
 *
 * @returns Array of SMS provider types
 */
export function getSmsProviders(): IntegrationProviderType[] {
  return ['openphone', 'sms']
}
