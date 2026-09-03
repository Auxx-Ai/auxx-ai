// packages/lib/src/seed/entity-migrations/migrations/123-part-sku-optional.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:123')

/**
 * Migration 123: Make part `part_sku` optional (money plan 39 section 6.2).
 *
 * Blank SKUs are the norm at small Shopify stores (22 of 276 variants on the
 * first DemoOrg1 sync; many stores have none), so a required SKU left such a
 * merchant with no parts and no line links. The registry flipped
 * `sku.capabilities.required` to false and `nullable` to true; this brings
 * existing orgs' CustomField rows in line, mirroring 104-vendor-sku-optional.
 * The SKU stays unique when set (`isUnique` is untouched).
 */
export const migration123PartSkuOptional: EntityMigration = {
  id: '123-part-sku-optional',
  description: 'Flip part part_sku CustomField.required to false',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const updated = await db
      .update(schema.CustomField)
      .set({ required: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, 'part'),
          eq(schema.CustomField.systemAttribute, 'part_sku'),
          eq(schema.CustomField.required, true)
        )
      )
      .returning({ id: schema.CustomField.id })

    const alreadyUpToDate = updated.length === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 123 applied', {
        organizationId,
        fieldsUpdated: updated.length,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
