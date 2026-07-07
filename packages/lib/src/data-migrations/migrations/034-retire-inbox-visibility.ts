// packages/lib/src/data-migrations/migrations/034-retire-inbox-visibility.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-034')

const RETIRED_ATTR = 'inbox_visibility'

/**
 * Retire the legacy `inbox_visibility` field (mail-permissions Phase 6). Its
 * values were converted into the `inbox_default_lens` floor by migration 033;
 * all readers/writers switched to `defaultLens`, and the registry entry is
 * removed in the same change. Drops the per-org `CustomField` rows and their
 * `FieldValue` cells. Idempotent — a re-run finds nothing to delete.
 */
export const migration034RetireInboxVisibility: DataMigrationDef = {
  id: '034-retire-inbox-visibility',
  description: 'Delete the retired inbox_visibility field defs + values',
  async run(db: Database): Promise<void> {
    const fields = await db
      .select({ id: schema.CustomField.id, organizationId: schema.CustomField.organizationId })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.systemAttribute, RETIRED_ATTR))
    if (fields.length === 0) {
      logger.info('No inbox_visibility fields to retire')
      return
    }
    const fieldIds = fields.map((f) => f.id)

    const deletedValues = await db
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, fieldIds))
      .returning({ id: schema.FieldValue.id })

    await db.delete(schema.CustomField).where(inArray(schema.CustomField.id, fieldIds))

    // Field defs live in the cached resource shapes — recompute so the field
    // disappears from forms/builders without a restart.
    const affectedOrgs = new Set(fields.map((f) => f.organizationId))
    for (const orgId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(orgId, ['customFields', 'resources'])
    }

    logger.info('Retired inbox_visibility', {
      fields: fieldIds.length,
      values: deletedValues.length,
      orgsInvalidated: affectedOrgs.size,
    })
  },
}
