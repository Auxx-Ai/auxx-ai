// packages/lib/src/data-migrations/migrations/192-remove-catalog-item.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { deleteEntityDefinitionDeep } from '../../entity-definitions/delete-entity-definition'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:192')

/** The relationship sides that live on surviving defs (`line_item`, `part`). */
const PARTNER_ATTRIBUTES = ['line_item_catalog_item', 'part_catalog_items'] as const

const CACHE_KEYS = ['customFields', 'resources', 'entityDefs', 'entityDefSlugs'] as const

export interface Migration192Result extends PerOrgMigrationResult {
  partnerFieldsRemoved: number
  catalogItemDefDeleted: boolean
  groupEntriesCleared: number
}

/**
 * Migration 192: delete the `catalog_item` definition (107 D1, F5). The part is the one register.
 *
 * Partner fields go first by `systemAttribute`, since a system field's stored inverse id is not
 * reliably a `CustomField.id`. The def itself goes through `deleteEntityDefinitionDeep`, which
 * cascades its fields, values, instances, record identities, connector items and mappings, and
 * sweeps the text-keyed timeline, ACL and import rows.
 *
 * Group entries still holding `catalogItemId` point at nothing; the entries value is dropped
 * (read back as `[]`) rather than deleting the group, so its name, discount and tax survive.
 */
export const migration192RemoveCatalogItem: PerOrgMigration = {
  id: '192-remove-catalog-item',
  description:
    'Deletes the catalog_item definition, its fields and records, the line_item and part ' +
    'relationship sides, and catalog group entries that still hold catalogItemId (107 D1).',

  async up(db: Database, organizationId: string): Promise<Migration192Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const removedPartners = await db
      .delete(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          inArray(schema.CustomField.systemAttribute, [...PARTNER_ATTRIBUTES])
        )
      )
      .returning({ id: schema.CustomField.id })

    const [catalogDef] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'catalog_item')
        )
      )
      .limit(1)
    if (catalogDef) {
      await deleteEntityDefinitionDeep({
        id: catalogDef.id,
        organizationId,
        db,
        allowSystemEntity: true,
      })
    }

    const clearedEntries = await db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(
            schema.FieldValue.fieldId,
            db
              .select({ id: schema.CustomField.id })
              .from(schema.CustomField)
              .where(
                and(
                  eq(schema.CustomField.organizationId, organizationId),
                  eq(schema.CustomField.systemAttribute, 'catalog_group_entries')
                )
              )
          ),
          sql`${schema.FieldValue.valueJson}::text LIKE '%"catalogItemId"%'`
        )
      )
      .returning({ id: schema.FieldValue.id })

    const result = {
      partnerFieldsRemoved: removedPartners.length,
      catalogItemDefDeleted: !!catalogDef,
      groupEntriesCleared: clearedEntries.length,
    }
    const changed =
      result.partnerFieldsRemoved > 0 ||
      result.catalogItemDefDeleted ||
      result.groupEntriesCleared > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 192 applied', { organizationId, ...result })
    }

    return { ...state, alreadyUpToDate: !changed, ...result }
  },
}
