// packages/lib/src/data-migrations/migrations/038-reseed-platform-providers-scope-trim.ts

import type { Database } from '@auxx/database'
import { ensurePlatformProviders } from '../../connections/providers'
import type { DataMigrationDef } from '../types'

/**
 * Re-upsert the platform built-in ConnectionDefinition rows (`ensurePlatformProviders` only
 * runs via the seed CLI / reseed script, never at boot). This pass propagates:
 * - the Google OAuth verification scope trim (gmail: `gmail.modify`-only; googleOAuth2Api:
 *   `drive.file` + `calendar.events`/`calendar.readonly` instead of full `drive`/`calendar`)
 * - `platformClientApproved=false` for the gmail row via `GOOGLE_PLATFORM_CREDENTIALS_APPROVED`.
 *   With the split gate (`resolveOwnClientRequirement`) this no longer forces bring-your-own-
 *   client: a pending-approval platform client is `ownClientOptional`, so new Gmail connections
 *   may still use the platform login (Google shows its "unverified app" gating) OR supply their
 *   own OAuth client, until Google verification completes.
 *
 * Idempotent: SELECTs by `(providerKey, major)` and UPDATEs in place, keeping row ids stable
 * so existing `Credential.connectionDefinitionId` FKs survive. Safe to re-run.
 */
export const migration038ReseedPlatformProvidersScopeTrim: DataMigrationDef = {
  id: '038-reseed-platform-providers-scope-trim',
  description: 'Re-upsert platform connection providers (Google scope trim + gmail approval gate)',
  async run(db: Database): Promise<void> {
    await ensurePlatformProviders(db)
  },
}
