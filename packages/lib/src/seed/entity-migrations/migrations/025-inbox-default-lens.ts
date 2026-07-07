// packages/lib/src/seed/entity-migrations/migrations/025-inbox-default-lens.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { INBOX_FIELDS } from '../../../resources/registry/resources/inbox-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:025')

/**
 * Migration 025: Add the `inbox_default_lens` system field to the inbox entity.
 *
 * The org-wide visibility floor of the mail-permissions plan (§2.2): every org
 * member sees the inbox's threads at this lens; explicit ResourceAccess grants
 * can only raise it. New orgs get the field from `createAllFields`; this
 * backfills the `CustomField` row for existing orgs. Data migration
 * `033-inbox-visibility-to-default-lens` (which sorts after this one) converts
 * each inbox's legacy `inbox_visibility` value into a default-lens FieldValue.
 */
export const migration025InboxDefaultLens: EntityMigration = {
  id: '025-inbox-default-lens',
  description: 'Add inbox_default_lens system field (mail-permissions visibility floor) to inbox',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      logger.warn('No inbox entity found, skipping default-lens field', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'inbox',
      inboxDef.id,
      { defaultLens: INBOX_FIELDS.defaultLens! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 025 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
