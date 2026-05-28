// packages/lib/src/seed/entity-migrations/migrations/023-contact-visitor-geo-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:023')

/**
 * Migration 023: Add city/region/country/timezone system fields to the
 * contact entity. Backfills the geo fields introduced for the chat-widget
 * visitor location feature into existing orgs.
 */
export const migration023ContactVisitorGeoFields: EntityMigration = {
  id: '023-contact-visitor-geo-fields',
  description: 'Add city/region/country/timezone system fields to contact',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const contactDef = existing.entityDefs.get('contact')
    if (!contactDef) {
      logger.warn('No contact entity found, skipping geo fields', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'contact',
      contactDef.id,
      {
        city: CONTACT_FIELDS.city!,
        region: CONTACT_FIELDS.region!,
        country: CONTACT_FIELDS.country!,
        timezone: CONTACT_FIELDS.timezone!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 023 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
