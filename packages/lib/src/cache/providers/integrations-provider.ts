// packages/lib/src/cache/providers/integrations-provider.ts

import { schema } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/types'
import { and, eq, isNull } from 'drizzle-orm'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Minimal integration row carried in the org cache. Joined with
 * `PLATFORM_CAPABILITIES` at read time to produce the kopilot integration
 * catalog. Excludes credentials and sync-state.
 */
export interface CachedIntegration {
  integrationId: string
  displayName: string
  platform: IntegrationProviderType
}

/** Computes the integration list for an organization, excluding soft-deleted rows. */
export const integrationsProvider: CacheProvider<CachedIntegration[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.Integration.id,
        name: schema.Integration.name,
        email: schema.Integration.email,
        provider: schema.Integration.provider,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, orgId),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt)
        )
      )

    return rows.map((r) => ({
      integrationId: r.id,
      displayName: r.name ?? r.email ?? r.provider,
      platform: r.provider,
    }))
  },
}
