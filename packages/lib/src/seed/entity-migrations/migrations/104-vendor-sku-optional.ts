// packages/lib/src/seed/entity-migrations/migrations/104-vendor-sku-optional.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:104')

/**
 * Migration 104: Make vendor_part `vendor_part_vendor_sku` optional.
 *
 * Under the (part, supplier) natural key the vendor's own SKU is metadata, not
 * identity, and supplier price lists routinely omit the column — with the field
 * required, every row of such a file fails. The registry flipped
 * `vendorSku.capabilities.required` to false; this brings existing orgs'
 * CustomField rows in line, mirroring 012-contact-email-optional.
 */
export const migration104VendorSkuOptional: EntityMigration = {
  id: '104-vendor-sku-optional',
  description: 'Flip vendor_part vendor_part_vendor_sku CustomField.required to false',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const updated = await db
      .update(schema.CustomField)
      .set({ required: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, 'vendor_part'),
          eq(schema.CustomField.systemAttribute, 'vendor_part_vendor_sku'),
          eq(schema.CustomField.required, true)
        )
      )
      .returning({ id: schema.CustomField.id })

    const alreadyUpToDate = updated.length === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 104 applied', {
        organizationId,
        fieldsUpdated: updated.length,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
