// packages/lib/src/seed/entity-migrations/migrations/016-strip-legacy-contact-id-from-field-updated.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:016')

/**
 * Migration 016: Strip the legacy `contactId` key from
 * `contact:field:updated` timeline rows.
 *
 * Why: migration 015 added the new `recordId` / `entityDefinitionId` /
 * `entitySlug` keys but left the old `contactId` key in place during the
 * UI-audit soak. With the audit complete (no UI consumer reads
 * `eventData.contactId`) this migration converges the row shape.
 *
 * Order matters: this MUST run after 015. The migration list in
 * `entity-migrations/index.ts` enforces ordering. We additionally guard
 * against running on a row that hasn't been backfilled yet by requiring
 * `eventData.recordId` to exist.
 *
 * Idempotent via `eventData ? 'contactId'` — re-runs skip rows that no
 * longer carry the legacy key.
 */
export const migration016StripLegacyContactIdFromFieldUpdated: EntityMigration = {
  id: '016-strip-legacy-contact-id-from-field-updated',
  description: 'Strip legacy contactId key from contact:field:updated timeline rows',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state: EntityMigrationResult = {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    }

    // Single SQL UPDATE: remove the contactId key from eventData JSONB on
    // every contact:field:updated row that still carries it AND has been
    // backfilled by migration 015. Returns row count for logging.
    const result = await db
      .update(schema.TimelineEvent)
      .set({
        eventData: sql`${schema.TimelineEvent.eventData} - 'contactId'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, organizationId),
          eq(schema.TimelineEvent.eventType, 'contact:field:updated'),
          sql`${schema.TimelineEvent.eventData} ? 'contactId'`,
          sql`${schema.TimelineEvent.eventData} ? 'recordId'`
        )
      )
      .returning({ id: schema.TimelineEvent.id })

    if (result.length === 0) return state

    logger.info('Migration 016 applied', {
      organizationId,
      rowsStripped: result.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}
