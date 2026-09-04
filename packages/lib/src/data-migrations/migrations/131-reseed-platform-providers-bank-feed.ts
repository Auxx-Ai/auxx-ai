// packages/lib/src/data-migrations/migrations/131-reseed-platform-providers-bank-feed.ts

import type { Database } from '@auxx/database'
import { ensurePlatformProviders } from '../../connections/providers'
import type { DataMigrationDef } from '../types'

/**
 * Bake the `stripeFinancialConnections` `ConnectionDefinition` into every
 * environment, so the bank feed has a definition to connect through.
 *
 * **This is the deploy step that fails silently**, and it is the same one 025,
 * 038, 089 and 092 exist for. `PLATFORM_PROVIDER_DEFS` is a code catalog read
 * only at seed time: `ensurePlatformProviders` bakes each def into a
 * `ConnectionDefinition` row, and adding a def to `defs.ts` and deploying
 * changes nothing at all on a database that was seeded before it. Every
 * environment keeps serving the rows baked by the last reseed, with no error
 * anywhere to say otherwise.
 *
 * What that costs here: `banking.connect` resolves the definition by
 * `providerKey` before it can open a Financial Connections session, so with no
 * row the Connect a bank button on Accounting > Settings > Bank accounts fails
 * for every org in the environment. Locally the row was put there by
 * `packages/lib/scripts/seed-bank-feed-provider.ts`, which is a developer's
 * script and reaches no deployed database.
 *
 * ⚠️ `reseedConnectionProvidersJob` also calls `ensurePlatformProviders`, which
 * is what production was relying on. That is a scheduled job, so whether the row
 * exists after a deploy is a question of when the job last ran - and a first
 * boot in a fresh environment has it existing only after the first tick. A
 * migration is the ordered, recorded, once-per-environment version of the same
 * call, and the two are safe together precisely because the operation is an
 * upsert.
 *
 * Idempotent, and safe against an org that already has the definition:
 * `ensurePlatformProviders` SELECTs by `(providerKey, major)` and UPDATEs in
 * place, so a row already present keeps its id and every
 * `Credential.connectionDefinitionId` FK pointing at it survives - including the
 * per-login credentials a `multiAccount` provider mints. Nothing here inserts a
 * second row or touches a credential.
 */
export const migration131ReseedPlatformProvidersBankFeed: DataMigrationDef = {
  id: '131-reseed-platform-providers-bank-feed',
  description: 'Reseed platform connection providers (Stripe Financial Connections bank feed)',
  async run(db: Database): Promise<void> {
    await ensurePlatformProviders(db)
  },
}
