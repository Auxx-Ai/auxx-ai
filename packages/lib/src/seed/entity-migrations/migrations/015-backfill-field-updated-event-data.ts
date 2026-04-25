// packages/lib/src/seed/entity-migrations/migrations/015-backfill-field-updated-event-data.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, sql } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:015')

/**
 * Migration 015: Backfill `recordId` / `entityDefinitionId` / `entitySlug`
 * onto legacy `contact:field:updated` timeline rows.
 *
 * Why: the contact-field-updated event payload was reshaped from
 * `{ contactId, ... }` to a uniform `{ recordId, entityDefinitionId,
 * entitySlug, ... }` shape (shared with the new `ticket:field:updated`
 * and `entity:field:updated` events). Existing rows still carry the old
 * `eventData` shape; this migration converges them on the new shape so a
 * future read-side switch to canonical RecordIds works without a special
 * case for legacy rows.
 *
 * Scope: only `contact:field:updated` rows exist today — the ticket and
 * entity variants were never emitted before this change. The legacy
 * `contactId` key is preserved during this migration; a follow-up
 * migration can strip it after a soak window confirms no readers remain.
 *
 * Idempotent via `NOT (eventData ? 'recordId')` — re-runs skip rows that
 * already carry the new fields.
 */
export const migration015BackfillFieldUpdatedEventData: EntityMigration = {
  id: '015-backfill-field-updated-event-data',
  description:
    'Backfill recordId/entityDefinitionId/entitySlug on legacy contact:field:updated timeline rows',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state: EntityMigrationResult = {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: true,
    }

    // 1. Resolve the contact EntityDefinition for this org.
    const [contactDef] = await db
      .select({ id: schema.EntityDefinition.id, apiSlug: schema.EntityDefinition.apiSlug })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'contact')
        )
      )
      .limit(1)

    if (!contactDef) return state

    // 2. Find legacy rows: contact:field:updated where eventData.recordId is missing.
    const legacyRows = await db
      .select({
        id: schema.TimelineEvent.id,
        entityId: schema.TimelineEvent.entityId,
        eventData: schema.TimelineEvent.eventData,
      })
      .from(schema.TimelineEvent)
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, organizationId),
          eq(schema.TimelineEvent.eventType, 'contact:field:updated'),
          sql`NOT (${schema.TimelineEvent.eventData} ? 'recordId')`
        )
      )

    if (legacyRows.length === 0) return state

    // 3. Backfill — chunk to bound the in-flight UPDATE count.
    const CHUNK = 500
    for (let i = 0; i < legacyRows.length; i += CHUNK) {
      const batch = legacyRows.slice(i, i + CHUNK)
      await Promise.all(
        batch.map((row) => {
          const recordId = toRecordId(contactDef.id, row.entityId)
          const merged = {
            ...((row.eventData as Record<string, unknown>) ?? {}),
            recordId,
            entityDefinitionId: contactDef.id,
            entitySlug: contactDef.apiSlug,
          }
          return db
            .update(schema.TimelineEvent)
            .set({ eventData: merged, updatedAt: new Date() })
            .where(eq(schema.TimelineEvent.id, row.id))
        })
      )
    }

    logger.info('Migration 015 applied', {
      organizationId,
      rowsBackfilled: legacyRows.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}
