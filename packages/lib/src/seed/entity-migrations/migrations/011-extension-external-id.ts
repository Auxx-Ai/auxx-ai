// packages/lib/src/seed/entity-migrations/migrations/011-extension-external-id.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:011')

/**
 * Migration 011: Add `externalId` system field to contact + company entities.
 *
 * Used by the Auxx Chrome extension as a stable cross-source identifier
 * (e.g. `linkedin:slug`, `gmail:address`) for dedup before creating new
 * records from a captured page.
 */
export const migration011ExtensionExternalId: EntityMigration = {
  id: '011-extension-external-id',
  description: 'Add externalId system field to contact and company entities',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const contactDef = existing.entityDefs.get('contact')
    if (contactDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDef.id,
        { externalId: CONTACT_FIELDS.externalId! },
        existing,
        state
      )
    } else {
      logger.warn('No contact entity found, skipping externalId on contact', { organizationId })
    }

    const companyDef = existing.entityDefs.get('company')
    if (companyDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'company',
        companyDef.id,
        { externalId: COMPANY_FIELDS.externalId! },
        existing,
        state
      )
    } else {
      logger.warn('No company entity found, skipping externalId on company', { organizationId })
    }

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 011 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
