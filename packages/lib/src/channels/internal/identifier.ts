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
    // Meta social channels identify by the account they post as, not an address:
    // the IG handle where there is one, otherwise the Facebook Page name. Read
    // from metadata rather than `Integration.name` so channels connected before
    // the name was persisted still show something other than a bare provider label.
    if ('instagramUsername' in metadata && typeof metadata.instagramUsername === 'string')
      return metadata.instagramUsername
    if ('pageName' in metadata && typeof metadata.pageName === 'string') return metadata.pageName
  }
  return channel.name || undefined
}
