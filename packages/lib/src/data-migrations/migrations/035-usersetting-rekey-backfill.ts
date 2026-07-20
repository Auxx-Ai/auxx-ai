// packages/lib/src/data-migrations/migrations/035-usersetting-rekey-backfill.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-035')

/** Dead `appearance.*` catalog keys removed by settings v2 (README §Deletions). */
const DEAD_APPEARANCE_KEYS = [
  'appearance.logo',
  'appearance.primaryColor',
  'appearance.secondaryColor',
  'appearance.font',
]

/**
 * Settings v2 dead-key cleanup (plans/settings/v2/README.md §Deletions):
 * deletes stored `OrganizationSetting` and `UserSetting` rows for the four
 * removed `appearance.*` keys.
 *
 * The `UserSetting` re-key this migration originally performed now happens
 * inline in drizzle migration `0273_settings_v2_rekey_drop_legacy_fk.sql` —
 * that file also drops the legacy `organizationSettingId` FK (from the DB and
 * the schema), so the join-based backfill is no longer expressible here. The
 * FK cascade the original delete relied on is gone with it, hence the explicit
 * `UserSetting` delete by key.
 *
 * Idempotent: both deletes are no-ops once the rows are gone.
 */
export const migration035UserSettingRekeyBackfill: DataMigrationDef = {
  id: '035-usersetting-rekey-backfill',
  description: 'Delete dead appearance.* organization/user settings (settings v2)',
  async run(db: Database): Promise<void> {
    const deadOrgSettings = await db
      .select({
        id: schema.OrganizationSetting.id,
        organizationId: schema.OrganizationSetting.organizationId,
      })
      .from(schema.OrganizationSetting)
      .where(inArray(schema.OrganizationSetting.key, DEAD_APPEARANCE_KEYS))

    if (deadOrgSettings.length > 0) {
      await db.delete(schema.OrganizationSetting).where(
        inArray(
          schema.OrganizationSetting.id,
          deadOrgSettings.map((s) => s.id)
        )
      )
    }

    await db.delete(schema.UserSetting).where(inArray(schema.UserSetting.key, DEAD_APPEARANCE_KEYS))

    const affectedOrgs = new Set(deadOrgSettings.map((s) => s.organizationId))
    for (const orgId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(orgId, ['orgSettings'])
    }

    logger.info('Deleted dead appearance.* settings', {
      deletedOrgSettings: deadOrgSettings.length,
      orgsInvalidated: affectedOrgs.size,
    })
  },
}
