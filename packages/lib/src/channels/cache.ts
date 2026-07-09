// packages/lib/src/channels/cache.ts

import type { Database } from '@auxx/database'
import { getOrgCache, onCacheEvent } from '../cache'
import type { ChannelProviderType } from '../providers/types'

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
 * Invalidate cached provider map for an organization.
 * Call when channels are added or removed.
 * @deprecated Use onCacheEvent('channel.connected', { orgId }) instead
 */
export async function invalidateOrgChannelProviderMap(organizationId: string): Promise<void> {
  await onCacheEvent('channel.connected', { orgId: organizationId })
}
