// packages/lib/src/seed/entity-migrations/migrations/006-company-domain-and-employer-cardinality.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:006')

/**
 * Migration 006: Add `companyDomain` field + normalize `contact_employer` cardinality
 *
 * - Adds `company_domain` CustomField on each org's company EntityDefinition (used
 *   for auto-linking contacts to companies by email domain).
 * - Flips existing `contact_employer` CustomField.options.relationship.relationshipType
 *   from `has_many` to `has_one` — a contact now has exactly one employer.
 */
export const migration006CompanyDomainAndEmployerCardinality: EntityMigration = {
  id: '006-company-domain-and-employer-cardinality',
  description:
    'Add companyDomain system field to company entity; normalize contact_employer relationshipType from has_many to has_one',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // ── 1. Add companyDomain field to the company EntityDefinition ──
    const companyDef = existing.entityDefs.get('company')
    if (!companyDef) {
      logger.warn('No company entity found, skipping companyDomain field', { organizationId })
    } else {
      await ensureCustomFields(
        db,
        organizationId,
        'company',
        companyDef.id,
        { companyDomain: COMPANY_FIELDS.companyDomain },
        existing,
        state
      )
    }

    // ── 2. Normalize contact_employer relationshipType (has_many → has_one) ──
    // Only updates rows that still have the old value, so it's a no-op for fresh
    // orgs seeded after this plan shipped (registry writes has_one from the start).
    const employerUpdate = await db.execute(sql`
      UPDATE "CustomField"
      SET
        options = jsonb_set(
          COALESCE(options, '{}'::jsonb),
          '{relationship,relationshipType}',
          '"has_one"'::jsonb,
          true
        ),
        "updatedAt" = NOW()
      WHERE "organizationId" = ${organizationId}
        AND "systemAttribute" = 'contact_employer'
        AND options -> 'relationship' ->> 'relationshipType' = 'has_many'
    `)

    const employerUpdated = Number((employerUpdate as { rowCount?: number | null })?.rowCount ?? 0)
    if (employerUpdated > 0) {
      state.relationshipsLinked += employerUpdated
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 006 applied', {
        organizationId,
        companyDomainCreated: state.fieldsCreated,
        employerUpdated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
