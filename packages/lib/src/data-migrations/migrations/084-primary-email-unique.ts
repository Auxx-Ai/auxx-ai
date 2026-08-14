// packages/lib/src/data-migrations/migrations/084-primary-email-unique.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-084')

/**
 * Mark the seeded contact `primary_email` field `isUnique` on existing orgs.
 *
 * **Why the registry flag alone is not enough.** `CONTACT_FIELDS.primaryEmail`
 * gained `capabilities.unique: true`, and the entity seeder maps that onto
 * `CustomField.isUnique` (`entity-seeder/utils.ts` → `mapCapabilities`) — but
 * only for orgs seeded AFTER the change. `create-fields.ts` inserts and never
 * updates, so existing orgs keep `isUnique = false` and the
 * `FieldValueService` uniqueness gate (`checkUniqueValueTyped`, keyed off
 * `field.isUnique`) never fires for them. That gate is the ONLY uniqueness
 * door for panel/bulk-edit writes (`fieldValue.set` / `applyBulk`), which
 * never run contact hooks — without this flip those orgs can claim another
 * contact's email through the panel. Same mechanism as migration 078.
 *
 * **Scoped to the system field.** Matched on
 * `systemAttribute = 'primary_email'`, the seeded identity of this field on
 * every org's `contact` def. Org-created EMAIL fields carry a NULL
 * `systemAttribute` and are untouched.
 *
 * **Pre-existing duplicates are left in place.** The gate is write-time only;
 * a duplicate pair created before this flip keeps both rows until one is
 * edited (at which point the edit conflicts). The dedup plan owns cleanup.
 *
 * **Cache clear is required and is ours.** The data-migration runner does not
 * invalidate org caches, and `customFields` / `resources` are cached per org.
 * Without the flush, orgs holding a warm blob keep serving `isUnique: false`
 * (and the write gate keeps not firing) until the key expires.
 *
 * Idempotent: the `WHERE` only matches rows still at `false`.
 */
export const migration084PrimaryEmailUnique: DataMigrationDef = {
  id: '084-primary-email-unique',
  description: 'Mark the seeded contact primary_email field isUnique (arms the write gate)',
  async run(db: Database): Promise<void> {
    const result = await db.execute<{ organizationId: string }>(sql`
      UPDATE "CustomField"
      SET "isUnique" = true, "updatedAt" = now()
      WHERE "systemAttribute" = 'primary_email'
        AND "isUnique" = false
      RETURNING "organizationId"
    `)

    const organizationIds = [...new Set(result.rows.map((r) => r.organizationId))]

    if (organizationIds.length > 0) {
      // Lazy so the data-migration graph does not pull the cache barrel (and its
      // Redis client) into every migration run.
      const { getOrgCache } = await import('../../cache')
      const cache = getOrgCache()
      await Promise.all(
        organizationIds.map((organizationId) =>
          cache.invalidateAndRecompute(organizationId, ['customFields', 'resources'])
        )
      )
    }

    logger.info('primary_email is now isUnique', {
      fieldsUpdated: result.rows.length,
      organizationsAffected: organizationIds.length,
    })
  },
}
