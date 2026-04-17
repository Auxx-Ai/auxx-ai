// packages/lib/src/seed/entity-migrations/migrations/007-entity-avatar-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:007')

/**
 * Entities to backfill + the systemAttribute of the CustomField that should
 * be used as the avatar source.
 */
const AVATAR_FIELD_BY_ENTITY: { entityType: string; systemAttribute: string }[] = [
  { entityType: 'company', systemAttribute: 'company_logo' },
  { entityType: 'part', systemAttribute: 'part_image' },
  { entityType: 'contact', systemAttribute: 'contact_avatar' },
]

/**
 * Migration 007: Link avatar fields on system EntityDefinitions
 *
 * - Seeds the contact `avatarUrl` CustomField (new — didn't exist before).
 * - Backfills `EntityDefinition.avatarFieldId` for company, part, and contact
 *   on every org. Without this, uploads wired to the avatar field never set
 *   `EntityInstance.avatarUrl` and the record drawer falls back to the icon.
 */
export const migration007EntityAvatarFields: EntityMigration = {
  id: '007-entity-avatar-fields',
  description:
    'Seed contact avatar CustomField and link EntityDefinition.avatarFieldId for company, part, contact',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // ── Step 1: Seed contact avatar CustomField (if missing) ──
    const contactDef = existing.entityDefs.get('contact')
    if (contactDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDef.id,
        { avatarUrl: CONTACT_FIELDS.avatarUrl },
        existing,
        state
      )
    }

    // Re-read state so the contact avatar field is visible for linking below.
    const after = state.fieldsCreated > 0 ? await loadExistingState(db, organizationId) : existing

    // ── Step 2: Backfill avatarFieldId on each EntityDefinition ──
    const now = new Date()
    for (const { entityType, systemAttribute } of AVATAR_FIELD_BY_ENTITY) {
      const entityDef = after.entityDefs.get(entityType)
      if (!entityDef) continue

      const field = after.fields.get(systemAttribute)
      if (!field || field.entityDefinitionId !== entityDef.id) continue

      const updated = await db
        .update(schema.EntityDefinition)
        .set({ avatarFieldId: field.id, updatedAt: now })
        .where(
          and(
            eq(schema.EntityDefinition.id, entityDef.id),
            isNull(schema.EntityDefinition.avatarFieldId)
          )
        )
        .returning({ id: schema.EntityDefinition.id })

      if (updated.length > 0) {
        state.relationshipsLinked += updated.length
        logger.debug(`Linked avatarFieldId for ${entityType}`, {
          organizationId,
          entityDefinitionId: entityDef.id,
          avatarFieldId: field.id,
        })
      }
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 007 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        avatarsLinked: state.relationshipsLinked,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
