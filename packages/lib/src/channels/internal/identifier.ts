// packages/lib/src/channels/internal/identifier.ts

import type { schema } from '@auxx/database'

interface ChannelIdentityRow {
  provider: string
  email: string | null
  metadata: unknown
  chatWidget?: typeof schema.ChatWidget.$inferSelect | null
}

interface ChannelLabelRow extends ChannelIdentityRow {
  name: string | null
}

/**
 * The channel's **routing identity** — the address it sends *as*, in the id
 * space {@link import('../capabilities').identifierTypeForProvider} names for
 * its provider.
 *
 * Never a display name, and structurally incapable of returning one: this feeds
 * `ParticipantService.findOrCreateParticipantForIntegration`, which mints the
 * FROM `Participant` of every outbound message from it. A label reaching this
 * return value becomes a `Participant.identifier` no provider can route, in a
 * row the reconciler never rewrites — the failure mode already documented on
 * that method, where composed SMS recorded the operator's *email* as its sender.
 *
 * Meta channels route by account id (Page id, IG business account id). The page
 * name and IG handle are labels and belong to {@link getChannelLabel}; a caller
 * that wants something human-readable must ask for it by name.
 *
 * Returns `undefined` when the channel has no addressable identity of its own.
 */
export function getIdentifier(channel: ChannelIdentityRow | null): string | undefined {
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
    // Meta social channels: the account id, never `pageName` / `instagramUsername`.
    // Instagram Direct addresses the IG business account; Messenger the Page.
    if (
      'instagramBusinessAccountId' in metadata &&
      typeof metadata.instagramBusinessAccountId === 'string'
    )
      return metadata.instagramBusinessAccountId
    if ('pageId' in metadata && typeof metadata.pageId === 'string') return metadata.pageId
  }
  return undefined
}

/**
 * Human label for a channel — what a picker, a channel list or a thread header
 * shows. Display only: never pass this to anything that routes, addresses or
 * keys a participant (see {@link getIdentifier}).
 *
 * Meta channels are read from `metadata` rather than `Integration.name` so
 * channels connected before the name was persisted still show the account they
 * post as instead of a bare provider label.
 */
export function getChannelLabel(channel: ChannelLabelRow | null): string | undefined {
  if (!channel) return undefined
  if (channel.provider === 'chat' && channel.chatWidget) {
    return channel.chatWidget.name
  }
  if (channel.name) return channel.name
  if (channel.email) return channel.email
  const metadata = channel.metadata
  if (metadata && typeof metadata === 'object') {
    if ('email' in metadata && typeof metadata.email === 'string') return metadata.email
    if ('phoneNumber' in metadata && typeof metadata.phoneNumber === 'string')
      return metadata.phoneNumber
    if ('instagramUsername' in metadata && typeof metadata.instagramUsername === 'string')
      return metadata.instagramUsername
    if ('pageName' in metadata && typeof metadata.pageName === 'string') return metadata.pageName
  }
  return undefined
}
