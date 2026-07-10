// packages/lib/src/data-migrations/migrations/035-usersetting-rekey-backfill.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, inArray, isNull, or } from 'drizzle-orm'
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
 * Settings v2 `UserSetting` re-key (plans/settings/v2/README.md §Service
 * refactor): backfills the new `organizationId`/`key` columns on `UserSetting`
 * from each row's parent `OrganizationSetting`, still reachable at this point
 * via the (not-yet-dropped) `organizationSettingId` FK — a second schema
 * migration tightens the new columns to NOT NULL and drops that FK once this
 * backfill has run. Also deletes stored `OrganizationSetting` rows for the
 * four dead `appearance.*` keys; any surviving `UserSetting` children
 * cascade-delete via the (still-present) FK.
 *
 * Idempotent: only backfills rows still missing `organizationId`/`key`; the
 * appearance-key delete is a no-op once already removed.
 */
export const migration035UserSettingRekeyBackfill: DataMigrationDef = {
  id: '035-usersetting-rekey-backfill',
  description: 'Backfill UserSetting.organizationId/key + delete dead appearance.* settings',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        id: schema.UserSetting.id,
        organizationId: schema.OrganizationSetting.organizationId,
        key: schema.OrganizationSetting.key,
      })
      .from(schema.UserSetting)
      .innerJoin(
        schema.OrganizationSetting,
        eq(schema.UserSetting.organizationSettingId, schema.OrganizationSetting.id)
      )
      .where(or(isNull(schema.UserSetting.organizationId), isNull(schema.UserSetting.key)))

    for (const row of rows) {
      await db
        .update(schema.UserSetting)
        .set({ organizationId: row.organizationId, key: row.key })
        .where(eq(schema.UserSetting.id, row.id))
    }

    logger.info('Backfilled UserSetting organizationId/key', { rowsBackfilled: rows.length })

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
