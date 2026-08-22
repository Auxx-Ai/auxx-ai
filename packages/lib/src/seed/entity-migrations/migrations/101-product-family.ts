// packages/lib/src/seed/entity-migrations/migrations/101-product-family.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { PRODUCT_FIELDS } from '../../../resources/registry/resources/product-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:101')

/**
 * Migration 101: the `product` entity — the family above `part`
 * (plans/products/01-product-family.md §1, §2, §5, §7).
 *
 * Def + PRODUCT_FIELDS + the two new relationship pairs:
 *
 *   part.product     belongs_to → product  (`part_product`,    nullable)
 *   product.parts    has_many   → part     (`product_parts`,   isInverse)
 *   product.vendor   belongs_to → company  (`product_vendor`,  nullable)
 *   company.products has_many   → product  (`company_products`, isInverse)
 *
 * `vendor` is a relation, not a string (01 §2): a supplier is already a
 * `company`. The Shopify `vendor` brand string is a different fact and lands in
 * an app field under contribute mode — this relation is linked by a human or
 * stays null. Deliberately absent: any option-axis field (01 §3), any
 * `product → catalog_item` edge (pricing stays on the part/catalog seam), and
 * `partKind` — that shipped in migration 100 with the parts plan.
 *
 * **No DDL.** `EntityDefinition.entityType` is a `text()` column, so a new
 * entity type is this migration plus the hand-edits to `enums.ts` /
 * `constants.ts` / the system-attribute union. Mirrors the 030/040 recipe.
 *
 * Idempotent — every helper is insert-only or skips existing rows.
 */
export const migration101ProductFamily: EntityMigration = {
  id: '101-product-family',
  description:
    'Add product as a system entity (product family above part) with vendor and part edges',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'product'),
      existing,
      state
    )

    // Pull the edge targets into the id map so linkNewRelationships can resolve
    // both directions of each pair.
    for (const type of ['part', 'company'] as const) {
      const def = existing.entityDefs.get(type)
      if (def) entityDefIds.set(type, def.id)
    }

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    const productDefId = entityDefIds.get('product')
    if (productDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'product',
          productDefId,
          PRODUCT_FIELDS,
          existing,
          state
        )
      )
    }

    // The `part_product` edge — part's only new field (01 §5).
    const partDefId = entityDefIds.get('part')
    if (partDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'part',
          partDefId,
          { product: PART_FIELDS.product! },
          existing,
          state
        )
      )
    }

    // The `company_products` inverse of `product_vendor` (01 §2).
    const companyDefId = entityDefIds.get('company')
    if (companyDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'company',
          companyDefId,
          { products: COMPANY_FIELDS.products! },
          existing,
          state
        )
      )
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['product'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'product',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'product',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 101 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
