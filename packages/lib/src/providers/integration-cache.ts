// packages/lib/src/providers/integration-cache.ts

import type { Database } from '@auxx/database'
import { getOrgCache, onCacheEvent } from '../cache'
import type { IntegrationProviderType } from './types'

/**
 * Get cached provider map for an organization.
 * Maps integrationId -> provider type.
 * Now served from the org cache.
 */
export async function getOrgProviderMap(
  organizationId: string,
  _db: Database
): Promise<Map<string, IntegrationProviderType>> {
  const { integrationProviders } = await getOrgCache().getOrRecompute(organizationId, [
    'integrationProviders',
  ])
  return new Map(Object.entries(integrationProviders)) as Map<string, IntegrationProviderType>
}

/**
 * Invalidate cached provider map for an organization.
 * Call when integrations are added or removed.
 * @deprecated Use onCacheEvent('integration.connected', { orgId }) instead
 */
export async function invalidateOrgProviderMap(organizationId: string): Promise<void> {
  await onCacheEvent('integration.connected', { orgId: organizationId })
}
