// packages/lib/src/channels/internal/identifier.ts

import type { schema } from '@auxx/database'

interface IdentifierRow {
  provider: string
  email: string | null
  name: string | null
  metadata: unknown
  chatWidget?: typeof schema.ChatWidget.$inferSelect | null
}

/**
 * Safely extract a human identifier (email, phone, widget name) from a
 * channel row plus optional joined ChatWidget.
 */
export function getIdentifier(channel: IdentifierRow | null): string | undefined {
  if (!channel) return undefined
  if (channel.provider === 'chat' && channel.chatWidget) {
    return channel.chatWidget.name
  }
  // Forwarding channels store the alias in Integration.email
  if (channel.email) return channel.email
  const metadata = channel.metadata
  if (metadata && typeof metadata === 'object') {
    if ('email' in metadata && typeof metadata.email === 'string') return metadata.email
    if ('phoneNumber' in metadata && typeof metadata.phoneNumber === 'string')
      return metadata.phoneNumber
  }
  return channel.name || undefined
}
