// packages/lib/src/data-migrations/migrations/036-documents-taxrates-scope.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-036')

/**
 * Money MQ2 settings (plans/dispatch/money/05-mq2-build.md §A.3): `documents.taxRates`
 * moves from the `GENERAL` scope to the new `DOCUMENTS` scope. The write path
 * self-heals (`settings-service.ts` stamps `scope` from the catalog on every
 * upsert), but existing stored rows still carry the stale `GENERAL` scope and
 * scope-filtered reads (`getAllOrganizationSettings`) would miss them until
 * they're next written. Backfill flips the scope column in place.
 *
 * Idempotent: only updates rows still stamped `GENERAL`.
 */
export const migration036DocumentsTaxRatesScope: DataMigrationDef = {
  id: '036-documents-taxrates-scope',
  description: "Flip OrganizationSetting.scope to DOCUMENTS for key 'documents.taxRates'",
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        id: schema.OrganizationSetting.id,
        organizationId: schema.OrganizationSetting.organizationId,
      })
      .from(schema.OrganizationSetting)
      .where(eq(schema.OrganizationSetting.key, 'documents.taxRates'))

    const stale = rows.length > 0
    if (stale) {
      await db
        .update(schema.OrganizationSetting)
        .set({ scope: 'DOCUMENTS' })
        .where(eq(schema.OrganizationSetting.key, 'documents.taxRates'))
    }

    const affectedOrgs = new Set(rows.map((r) => r.organizationId))
    for (const orgId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(orgId, ['orgSettings'])
    }

    logger.info('Flipped documents.taxRates rows to DOCUMENTS scope', {
      rowsUpdated: rows.length,
      orgsInvalidated: affectedOrgs.size,
    })
  },
}
