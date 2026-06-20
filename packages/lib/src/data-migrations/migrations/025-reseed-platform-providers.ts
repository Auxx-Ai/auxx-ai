// packages/lib/src/data-migrations/migrations/025-reseed-platform-providers.ts

import type { Database } from '@auxx/database'
import { ensurePlatformProviders } from '../../connections/providers'
import type { DataMigrationDef } from '../types'

/**
 * Re-upsert the platform built-in ConnectionDefinition rows so deployed environments pick up
 * def changes that aren't otherwise applied automatically (`ensurePlatformProviders` only runs
 * via the seed CLI / reseed script, never at boot). This pass propagates the `baseUrlTemplate`
 * column added in `plans/connections/connection-definition-values.md` §2a (Shopify + Airtable).
 *
 * Idempotent: `ensurePlatformProviders` SELECTs by `(providerKey, major)` and UPDATEs in place,
 * keeping row ids stable so existing `Credential.connectionDefinitionId` FKs survive. Safe to
 * re-run; a fresh environment (already seeded) is a no-op reconcile.
 */
export const migration025ReseedPlatformProviders: DataMigrationDef = {
  id: '025-reseed-platform-providers',
  description: 'Re-upsert platform connection providers (propagate baseUrlTemplate + def changes)',
  async run(db: Database): Promise<void> {
    await ensurePlatformProviders(db)
  },
}
