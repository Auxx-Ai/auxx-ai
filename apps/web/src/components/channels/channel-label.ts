// apps/web/src/components/channels/channel-label.ts

import { PLATFORM_CAPABILITIES } from '@auxx/lib/channels/client'

/**
 * What the user sees in the From row: the identity the message will come FROM.
 *
 * `identifier` is the server-resolved *routing* identity (`channels/internal/
 * identifier.ts`) and is only something a human recognises where the address
 * space is one they read — an email address or a phone number. On Meta channels
 * it is deliberately an opaque account id (Page id / IG business account id, see
 * that file's contract), so showing it rendered a bare number in the From row.
 *
 * So: `identifier` for the addressable models (`email` / `phone`), and the
 * server-computed `displayName` (`getChannelLabel` — Page name, IG handle,
 * widget name) for everything else. Reading `email` first, as an earlier version
 * did, renders an empty badge for a phone channel: an SMS `Integration` carries
 * no `email`, and `name` is null on a channel the user never renamed.
 */
export function channelLabel(channel: {
  provider: string
  identifier?: string
  displayName?: string | null
  email?: string
  name: string | null
}) {
  const caps = PLATFORM_CAPABILITIES[channel.provider as keyof typeof PLATFORM_CAPABILITIES]
  const addressable = caps?.recipientModel === 'email' || caps?.recipientModel === 'phone'
  if (addressable && channel.identifier) return channel.identifier
  return (
    channel.displayName || channel.identifier || channel.email || channel.name || 'Unnamed channel'
  )
}
