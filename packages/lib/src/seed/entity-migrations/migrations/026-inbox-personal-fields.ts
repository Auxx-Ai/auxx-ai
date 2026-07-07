// packages/lib/src/seed/entity-migrations/migrations/026-inbox-personal-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { INBOX_FIELDS } from '../../../resources/registry/resources/inbox-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:026')

/**
 * Migration 026: Add the personal-account fields to the inbox entity
 * (mail-permissions §11): `inbox_is_personal` marks an inbox as one user's
 * connected personal mailbox (admins capped at activity-only, invisible to
 * automation) and `inbox_owner_user_id` records who owns it. New orgs get
 * both from `createAllFields`; this backfills the `CustomField` rows for
 * existing orgs. No data migration needed — no personal inboxes exist yet.
 */
export const migration026InboxPersonalFields: EntityMigration = {
  id: '026-inbox-personal-fields',
  description: 'Add inbox_is_personal + inbox_owner_user_id system fields (personal accounts §11)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      logger.warn('No inbox entity found, skipping personal fields', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'inbox',
      inboxDef.id,
      {
        isPersonal: INBOX_FIELDS.isPersonal!,
        ownerUserId: INBOX_FIELDS.ownerUserId!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 026 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
