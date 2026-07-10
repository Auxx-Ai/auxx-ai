// packages/lib/src/data-migrations/registry.ts

import { ALL_ENTITY_MIGRATIONS } from '../seed/entity-migrations'
import { migration024VerifyCredentialV2Backfill } from './migrations/024-verify-credential-v2-backfill'
import { migration025ReseedPlatformProviders } from './migrations/025-reseed-platform-providers'
import { migration026NormalizeChannelCredentials } from './migrations/026-normalize-channel-credentials'
import { migration027BackfillCredentialDefinitionFk } from './migrations/027-backfill-credential-definition-fk'
import { migration028DataConnectorStreamSyncModeWebhook } from './migrations/028-data-connector-stream-syncmode-webhook'
import { migration029SeedRecordIdentityIndex } from './migrations/029-seed-record-identity-index'
import { migration030RetireShopifyProductLinkId } from './migrations/030-retire-shopify-product-link-id'
import { migration031BackfillThreadInboxId } from './migrations/031-backfill-thread-inbox-id'
import { migration032BackfillThreadParticipants } from './migrations/032-backfill-thread-participants'
import { migration033InboxVisibilityToDefaultLens } from './migrations/033-inbox-visibility-to-default-lens'
import { migration034RetireInboxVisibility } from './migrations/034-retire-inbox-visibility'
import { migration035UserSettingRekeyBackfill } from './migrations/035-usersetting-rekey-backfill'
import { migration036DocumentsTaxRatesScope } from './migrations/036-documents-taxrates-scope'
import { assertUniqueMigrationIds } from './plan'
import type { DataMigrationDef } from './types'
import { wrapEntityMigration } from './wrap-entity-migration'

/**
 * Build the registry of all available data migrations, sorted by id.
 *
 * Today this is exactly the 23 entity migrations, adapted via {@link wrapEntityMigration}.
 * Pure-data migrations are authored as `migrations/NNN-slug.ts` exporting a
 * `DataMigrationDef` and appended to the spread below — they share the same global
 * id sequence as the entity migrations (a `025` backfill can depend on a field a
 * `024` migration creates; fail-stop enforces the order).
 */
function buildRegistry(): DataMigrationDef[] {
  const all: DataMigrationDef[] = [
    ...ALL_ENTITY_MIGRATIONS.map(wrapEntityMigration),
    // Pure-data migrations go here, e.g. migration024BackfillFoo
    migration024VerifyCredentialV2Backfill,
    migration025ReseedPlatformProviders,
    migration026NormalizeChannelCredentials,
    migration027BackfillCredentialDefinitionFk,
    migration028DataConnectorStreamSyncModeWebhook,
    migration029SeedRecordIdentityIndex,
    migration030RetireShopifyProductLinkId,
    migration031BackfillThreadInboxId,
    migration032BackfillThreadParticipants,
    migration033InboxVisibilityToDefaultLens,
    migration034RetireInboxVisibility,
    migration035UserSettingRekeyBackfill,
    migration036DocumentsTaxRatesScope,
  ]

  all.sort((a, b) => a.id.localeCompare(b.id))

  // Fail loud at module load if two migrations claim the same id.
  assertUniqueMigrationIds(all)

  return all
}

export const ALL_DATA_MIGRATIONS: DataMigrationDef[] = buildRegistry()
