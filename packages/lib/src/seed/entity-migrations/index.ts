// packages/lib/src/seed/entity-migrations/index.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import { migration001VendorPartSubpart } from './migrations/001-vendor-part-subpart'
import { migration002StockMovement } from './migrations/002-stock-movement-inventory'
import { migration003BomStockMovementFields } from './migrations/003-bom-stock-movement-fields'
import { migration004Company } from './migrations/004-company'
import { migration005Meeting } from './migrations/005-meeting'
import { migration006CompanyDomainAndEmployerCardinality } from './migrations/006-company-domain-and-employer-cardinality'
import { migration007EntityAvatarFields } from './migrations/007-entity-avatar-fields'
import { migration008CompanyEnrichmentFields } from './migrations/008-company-enrichment-fields'
import { migration009ParticipantIsInternal } from './migrations/009-participant-is-internal'
import { migration010OrganizationAiQuota } from './migrations/010-organization-ai-quota'
import { migration011ExtensionExternalId } from './migrations/011-extension-external-id'
import { migration012ContactEmailOptional } from './migrations/012-contact-email-optional'
import { migration013ContactCompanyExternalIdFix } from './migrations/013-contact-company-external-id-fix'
import { migration014BackfillSystemTags } from './migrations/014-backfill-system-tags'
import type { EntityMigration, MigrationRunResult } from './types'

const logger = createScopedLogger('entity-migrations')

// ─── Migration Registry ──────────────────────────────────────────────
// Add new migrations here in order. Each must be idempotent.

const ALL_MIGRATIONS: EntityMigration[] = [
  migration001VendorPartSubpart,
  migration002StockMovement,
  migration003BomStockMovementFields,
  migration004Company,
  migration005Meeting,
  migration006CompanyDomainAndEmployerCardinality,
  migration007EntityAvatarFields,
  migration008CompanyEnrichmentFields,
  migration009ParticipantIsInternal,
  migration010OrganizationAiQuota,
  migration011ExtensionExternalId,
  migration012ContactEmailOptional,
  migration013ContactCompanyExternalIdFix,
  migration014BackfillSystemTags,
]

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run all entity migrations for every organization.
 * Each migration is idempotent — safe to re-run on any org.
 */
export async function runAllEntityMigrations(db: Database): Promise<MigrationRunResult[]> {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)

  logger.info(`Running entity migrations for ${orgs.length} organizations`)
  const results: MigrationRunResult[] = []

  for (const org of orgs) {
    const result = await runEntityMigrationsForOrg(db, org.id)
    results.push(result)
  }

  const totalCreated = results.reduce(
    (acc, r) =>
      acc +
      r.migrations.reduce((a, m) => a + m.result.entityDefsCreated + m.result.fieldsCreated, 0),
    0
  )
  // Flush entity/field caches for all orgs so they pick up new definitions
  if (totalCreated > 0) {
    logger.info('Flushing entity and field caches for all orgs')
    await getOrgCache().flushKeyForAllOrgs([
      'entityDefs',
      'entityDefSlugs',
      'customFields',
      'resources',
    ])
  }

  logger.info(`Entity migrations complete`, {
    orgs: orgs.length,
    totalRecordsCreated: totalCreated,
    errors: results.filter((r) => r.error).length,
  })

  return results
}

/**
 * Run all entity migrations for a single organization.
 */
export async function runEntityMigrationsForOrg(
  db: Database,
  organizationId: string
): Promise<MigrationRunResult> {
  const result: MigrationRunResult = { organizationId, migrations: [] }

  for (const migration of ALL_MIGRATIONS) {
    try {
      const migrationResult = await migration.up(db, organizationId)
      result.migrations.push({ id: migration.id, result: migrationResult })

      if (!migrationResult.alreadyUpToDate) {
        logger.info(`Migration ${migration.id} applied`, {
          organizationId,
          entityDefsCreated: migrationResult.entityDefsCreated,
          fieldsCreated: migrationResult.fieldsCreated,
          relationshipsLinked: migrationResult.relationshipsLinked,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Migration ${migration.id} failed`, { organizationId, error: message })
      result.error = `${migration.id}: ${message}`
      break // Stop running further migrations for this org on failure
    }
  }

  // Flush caches for this org if anything changed
  const anyChanges = result.migrations.some((m) => !m.result.alreadyUpToDate)
  if (anyChanges) {
    const cache = getOrgCache()
    await cache.invalidateAndRecompute(organizationId, [
      'entityDefs',
      'entityDefSlugs',
      'customFields',
      'resources',
    ])
  }

  return result
}

/** List all registered migrations */
export function listEntityMigrations(): { id: string; description: string }[] {
  return ALL_MIGRATIONS.map((m) => ({ id: m.id, description: m.description }))
}

export type { EntityMigration, EntityMigrationResult, MigrationRunResult } from './types'
