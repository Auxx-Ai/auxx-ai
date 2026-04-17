// packages/lib/src/seed/entity-migrations/migrations/008-company-enrichment-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:008')

/**
 * Migration 008: Add company enrichment tracking fields
 *
 * Adds `enrichedAt` and `enrichmentStatus` CustomFields on each org's company
 * EntityDefinition. These are hidden fields written by the enrichment trigger
 * when a new company is created from a domain.
 */
export const migration008CompanyEnrichmentFields: EntityMigration = {
  id: '008-company-enrichment-fields',
  description: 'Add enrichedAt and enrichmentStatus system fields to company entity',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const companyDef = existing.entityDefs.get('company')
    if (!companyDef) {
      logger.warn('No company entity found, skipping enrichment fields', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'company',
      companyDef.id,
      {
        enrichedAt: COMPANY_FIELDS.enrichedAt!,
        enrichmentStatus: COMPANY_FIELDS.enrichmentStatus!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 008 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
