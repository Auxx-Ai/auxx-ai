// packages/lib/src/channels/cache.ts

import type { Database } from '@auxx/database'
import { getOrgCache, onCacheEvent } from '../cache'
import type { ChannelProviderType } from '../providers/types'
import { buildOrgOwnEmailAddressSet } from './own-addresses'

/**
 * Get cached provider map for an organization.
 * Maps channelId -> provider type.
 * Served from the org cache.
 */
export async function getOrgChannelProviderMap(
  organizationId: string,
  _db: Database
): Promise<Map<string, ChannelProviderType>> {
  const { channelProviders } = await getOrgCache().getOrRecompute(organizationId, [
    'channelProviders',
  ])
  return new Map(Object.entries(channelProviders)) as Map<string, ChannelProviderType>
}

/**
 * Per-channel bidirectional-status-sync flag, keyed by integration id.
 *
 * Opt-out semantics: a channel is enabled unless its settings explicitly set
 * `bidirectionalSyncEnabled === false`. Reads the `channels` cache (which
 * carries `settings` and is invalidated by `channel.settings_updated`), so a
 * toggle flip takes effect without a TTL wait. Absent integrations resolve to
 * `true` via `map.get(id) ?? true` at the call site.
 */
export async function getOrgChannelBidirectionalSyncMap(
  organizationId: string,
  _db: Database
): Promise<Map<string, boolean>> {
  const channels = await getOrgCache().get(organizationId, 'channels')
  return new Map(channels.map((c) => [c.id, c.settings?.bidirectionalSyncEnabled !== false]))
}

/**
 * Org-wide "us" address set for message DIRECTION — see
 * `buildOrgOwnEmailAddressSet`. Convenience wrapper for callers that don't
 * already hold the `channels` cache rows (currently only the SES inbound
 * processor, which has no other reason to read this cache). Ingest stamps
 * `fromOwnAddress` from the same builder but reads the `channels` cache
 * directly, to keep its cache dependency to a single mockable call on the hot
 * path.
 *
 * Personal-inbox channels are EXCLUDED: their addresses belong to a human who
 * also writes mail by hand, so a message from one arriving at a shared channel
 * is inbound on that channel, not the org replying to itself.
 */
export async function getOrgOwnEmailAddresses(organizationId: string): Promise<Set<string>> {
  const [channels, inboxes] = await Promise.all([
    getOrgCache().get(organizationId, 'channels'),
    getOrgCache().get(organizationId, 'inboxes'),
  ])
  const personalInboxIds = new Set(inboxes.filter((inbox) => inbox.isPersonal).map((i) => i.id))
  return buildOrgOwnEmailAddressSet(channels, { excludeInboxIds: personalInboxIds })
}

/**
 * Invalidate cached provider map for an organization.
 * Call when channels are added or removed.
 * @deprecated Use onCacheEvent('channel.connected', { orgId }) instead
 */
export async function invalidateOrgChannelProviderMap(organizationId: string): Promise<void> {
  await onCacheEvent('channel.connected', { orgId: organizationId })
}
