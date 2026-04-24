// packages/lib/src/seed/entity-migrations/migrations/012-contact-email-optional.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:012')

/**
 * Migration 012: Make contact `primary_email` optional.
 *
 * The registry flipped `primaryEmail.capabilities.required` from true to false,
 * but existing orgs' CustomField rows were seeded with `required = true` and
 * `ensureCustomFields` only creates new rows — it never updates existing ones.
 * This migration brings existing orgs in line with the current registry.
 */
export const migration012ContactEmailOptional: EntityMigration = {
  id: '012-contact-email-optional',
  description: 'Flip contact primary_email CustomField.required to false',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const updated = await db
      .update(schema.CustomField)
      .set({ required: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, 'contact'),
          eq(schema.CustomField.systemAttribute, 'primary_email'),
          eq(schema.CustomField.required, true)
        )
      )
      .returning({ id: schema.CustomField.id })

    const alreadyUpToDate = updated.length === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 012 applied', {
        organizationId,
        fieldsUpdated: updated.length,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
