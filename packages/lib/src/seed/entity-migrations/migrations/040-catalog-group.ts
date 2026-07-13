// packages/lib/src/seed/entity-migrations/migrations/040-catalog-group.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { CATALOG_GROUP_FIELDS } from '../../../resources/registry/resources/catalog-group-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:040')

/**
 * Migration 040: `catalog_group` — admin-defined bundles of `catalog_item` entries
 * (plans/dispatch/money/09-product-groups.md). Def + fields + default panel/table field
 * views. No relationships to link — `catalog_group_entries` (JSON) references catalog items
 * by plain id inside the array, not via a `RELATIONSHIP` field.
 *
 * No DDL — pure EntityInstance def, mirrors 032's `catalog_item` recipe.
 */
export const migration040CatalogGroup: EntityMigration = {
  id: '040-catalog-group',
  description: 'Add catalog_group as a system entity (product-group bundles)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'catalog_group'),
      existing,
      state
    )

    const catalogGroupDefId = entityDefIds.get('catalog_group')
    if (!catalogGroupDefId) {
      return { ...state, alreadyUpToDate: true }
    }

    const allFieldMaps = await ensureCustomFields(
      db,
      organizationId,
      'catalog_group',
      catalogGroupDefId,
      CATALOG_GROUP_FIELDS,
      existing,
      state
    )

    await linkDisplayFields(db, ['catalog_group'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'catalog_group',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'catalog_group',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'catalog_group_entries',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 040 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
