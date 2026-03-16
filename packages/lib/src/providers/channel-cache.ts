// packages/lib/src/providers/channel-cache.ts

import type { Database } from '@auxx/database'
import { getOrgCache, onCacheEvent } from '../cache'
import type { ChannelProviderType } from './types'

/**
 * Get cached provider map for an organization.
 * Maps channelId -> provider type.
 * Now served from the org cache.
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
 * Invalidate cached provider map for an organization.
 * Call when channels are added or removed.
 * @deprecated Use onCacheEvent('channel.connected', { orgId }) instead
 */
export async function invalidateOrgChannelProviderMap(organizationId: string): Promise<void> {
  await onCacheEvent('channel.connected', { orgId: organizationId })
}
