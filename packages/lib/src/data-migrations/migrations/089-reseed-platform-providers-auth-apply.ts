// packages/lib/src/data-migrations/migrations/089-reseed-platform-providers-auth-apply.ts

import type { Database } from '@auxx/database'
import { ensurePlatformProviders } from '../../connections/providers'
import type { DataMigrationDef } from '../types'

/**
 * Re-upsert the platform built-in `ConnectionDefinition` rows (`ensurePlatformProviders`
 * only runs via the seed CLI / reseed script, never at boot — see 025 and 038). This pass
 * propagates two changes that are otherwise invisible on any DB seeded before them:
 *
 * - **`openphone` / `airtableApi` auth** now interpolate `{apiKey}` instead of the shared
 *   `BEARER` (`Bearer {value}`). `{value}` resolves from `secrets.accessToken || secrets.secret`,
 *   which a `secret` connection with a NAMED variable never sets — it files the key under
 *   `secrets.fields.apiKey`. Both providers were sending `Authorization: Bearer ` (empty) and
 *   401ing on every `applyAuth` consumer, which is why the Quo contacts data-connector's
 *   test-fetch failed while the SMS channel on the same credential kept working (it hand-rolls
 *   its own header in `providers/openphone/api.ts`).
 * - **`openphone` connection variables**, trimmed to the API key alone in #1646. Rows seeded
 *   before that still demand `phoneNumberId` / `phoneNumber` / `webhookSigningSecret`, and the
 *   `phoneNumberId` pattern (`^pnv_.+`) does not match real Quo ids (`PN…`), so the connect
 *   form on a stale row cannot be submitted at all.
 *
 * Idempotent: SELECTs by `(providerKey, major)` and UPDATEs in place, keeping row ids stable
 * so existing `Credential.connectionDefinitionId` FKs survive. Safe to re-run.
 */
export const migration089ReseedPlatformProvidersAuthApply: DataMigrationDef = {
  id: '089-reseed-platform-providers-auth-apply',
  description: 'Re-upsert platform connection providers (secret-connection authApply + Quo vars)',
  async run(db: Database): Promise<void> {
    await ensurePlatformProviders(db)
  },
}
