// packages/lib/src/seed/entity-migrations/migrations/022-inbox-visual-ref.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:022')

/**
 * Migration 022: Inbox visual ref
 *
 * - Links the inbox `EntityDefinition.avatarFieldId` to the `inbox_color`
 *   CustomField so that future writes to inbox color flow through the
 *   display-sync hook and update `EntityInstance.avatarUrl`.
 * - Backfills `EntityInstance.avatarUrl = 'color:<value>'` for every existing
 *   inbox instance (defaulting to `color:indigo` when the field value is
 *   missing). The encoder hook only runs on subsequent FieldValue writes, so
 *   without this backfill, previously-created inboxes would render with the
 *   default icon until they're next edited.
 */
export const migration022InboxVisualRef: EntityMigration = {
  id: '022-inbox-visual-ref',
  description: 'Link inbox avatarFieldId to inbox_color and backfill EntityInstance.avatarUrl',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const colorField = existing.fields.get(fieldKey(inboxDef.id, 'inbox_color'))
    if (!colorField) {
      logger.warn('inbox_color CustomField missing; cannot link avatarFieldId', {
        organizationId,
        inboxDefId: inboxDef.id,
      })
      return { ...state, alreadyUpToDate: true }
    }

    const now = new Date()

    // ── Step 1: Link avatarFieldId on the inbox EntityDefinition ──
    const linked = await db
      .update(schema.EntityDefinition)
      .set({ avatarFieldId: colorField.id, updatedAt: now })
      .where(
        and(
          eq(schema.EntityDefinition.id, inboxDef.id),
          isNull(schema.EntityDefinition.avatarFieldId)
        )
      )
      .returning({ id: schema.EntityDefinition.id })

    if (linked.length > 0) {
      state.relationshipsLinked += linked.length
    }

    // ── Step 2: Backfill EntityInstance.avatarUrl for existing inboxes ──
    // Encode the inbox_color value (or default 'indigo') as 'color:<value>'.
    // Only touches rows whose avatarUrl is still null — idempotent re-run safe.
    const backfilled = await db.execute(sql`
      UPDATE "EntityInstance" ei
      SET "avatarUrl" = 'color:' || COALESCE(fv."valueText", 'indigo'),
          "updatedAt" = ${now}
      FROM "EntityInstance" ei2
      LEFT JOIN "FieldValue" fv
        ON fv."entityId" = ei2.id
       AND fv."fieldId" = ${colorField.id}
       AND fv."organizationId" = ${organizationId}
      WHERE ei.id = ei2.id
        AND ei."organizationId" = ${organizationId}
        AND ei."entityDefinitionId" = ${inboxDef.id}
        AND ei."avatarUrl" IS NULL
    `)

    const rowsBackfilled = (backfilled as unknown as { rowCount?: number }).rowCount ?? 0

    const alreadyUpToDate = state.relationshipsLinked === 0 && rowsBackfilled === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 022 applied', {
        organizationId,
        avatarFieldLinked: state.relationshipsLinked > 0,
        inboxesBackfilled: rowsBackfilled,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
