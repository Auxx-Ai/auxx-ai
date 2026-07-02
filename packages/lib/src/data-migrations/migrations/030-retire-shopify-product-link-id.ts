// packages/lib/src/data-migrations/migrations/030-retire-shopify-product-link-id.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, inArray } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-030')

const RETIRED_ATTR = 'shopify_product_link_id'

/**
 * Retire the dead-end `part.shopify_product_link_id` field. It was a hand-typed, product-level
 * TEXT with zero downstream readers — superseded by the variant-level `inventory_bridge_part`
 * relationship (v9). Removed from the resource registry in the same change; this drops its
 * per-org `CustomField` rows and their `FieldValue` cells so it disappears from the builder and
 * part forms. Idempotent — a re-run finds nothing to delete.
 */
export const migration030RetireShopifyProductLinkId: DataMigrationDef = {
  id: '030-retire-shopify-product-link-id',
  description: 'Delete the retired part.shopify_product_link_id field defs + values',
  async run(db: Database): Promise<void> {
    const fields = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.systemAttribute, RETIRED_ATTR))
    if (fields.length === 0) {
      logger.info('No shopify_product_link_id fields to retire')
      return
    }
    const fieldIds = fields.map((f) => f.id)

    const deletedValues = await db
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, fieldIds))
      .returning({ id: schema.FieldValue.id })

    await db.delete(schema.CustomField).where(inArray(schema.CustomField.id, fieldIds))

    logger.info('Retired shopify_product_link_id', {
      fields: fieldIds.length,
      values: deletedValues.length,
    })
  },
}
