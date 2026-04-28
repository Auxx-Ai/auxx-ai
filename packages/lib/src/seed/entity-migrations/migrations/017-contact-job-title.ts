// packages/lib/src/seed/entity-migrations/migrations/017-contact-job-title.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:017')

/**
 * Migration 017: Add `jobTitle` system field to contact entity.
 */
export const migration017ContactJobTitle: EntityMigration = {
  id: '017-contact-job-title',
  description: 'Add jobTitle system field to contact entity',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const contactDef = existing.entityDefs.get('contact')
    if (!contactDef) {
      logger.warn('No contact entity found, skipping jobTitle field', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'contact',
      contactDef.id,
      { jobTitle: CONTACT_FIELDS.jobTitle! },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 017 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
