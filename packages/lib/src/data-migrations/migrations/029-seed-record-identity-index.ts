// packages/lib/src/data-migrations/migrations/029-seed-record-identity-index.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { reconcileRecordIdentities } from '../../identity'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-029')

/**
 * One-shot seed of the `RecordIdentity` index from the existing identity
 * `FieldValue` cells (`FieldValue ⋈ CustomField(isIdentity)`), org by org.
 *
 * This is NOT a legacy-store parse — the retired `EntityInstance.integrationSource`
 * (connector provenance, not an identity) and the `external_id` array (disposable
 * dev/test data) are simply dropped, not migrated. The only real identity worth
 * preserving already lives in `FieldValue`, so this just invokes the same
 * reconcile primitive the recurring cron uses, once, so the badge + reverse
 * lookup have a populated index immediately after deploy. Idempotent.
 */
export const migration029SeedRecordIdentityIndex: DataMigrationDef = {
  id: '029-seed-record-identity-index',
  description: 'Seed RecordIdentity from identity FieldValue cells (reconcile one-shot)',
  async run(db: Database): Promise<void> {
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)

    let upserted = 0
    let skipped = 0
    for (const org of orgs) {
      const result = await reconcileRecordIdentities(org.id, db)
      upserted += result.upserted
      skipped += result.skipped
    }

    logger.info('Seeded RecordIdentity index', {
      organizations: orgs.length,
      upserted,
      skipped,
    })
  },
}
