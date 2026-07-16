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
import { migration015BackfillFieldUpdatedEventData } from './migrations/015-backfill-field-updated-event-data'
import { migration016StripLegacyContactIdFromFieldUpdated } from './migrations/016-strip-legacy-contact-id-from-field-updated'
import { migration017ContactJobTitle } from './migrations/017-contact-job-title'
import { migration018ArticleTags } from './migrations/018-article-tags'
import { migration019TagScope } from './migrations/019-tag-scope'
import { migration020ArticleNewFields } from './migrations/020-article-new-fields'
import { migration021SignatureFieldsPrefix } from './migrations/021-signature-fields-prefix'
import { migration022InboxVisualRef } from './migrations/022-inbox-visual-ref'
import { migration023ContactVisitorGeoFields } from './migrations/023-contact-visitor-geo-fields'
import { migration024ThreadVisitFields } from './migrations/024-thread-visit-fields'
import { migration025InboxDefaultLens } from './migrations/025-inbox-default-lens'
import { migration026InboxPersonalFields } from './migrations/026-inbox-personal-fields'
import { migration027PartsV2 } from './migrations/027-parts-v2'
import { migration028PartImageAvatar } from './migrations/028-part-image-avatar'
import { migration029WorkOrder } from './migrations/029-work-order'
import { migration030ServiceRequest } from './migrations/030-service-request'
import { migration031DocumentsFieldHiddenInDialogs } from './migrations/031-documents-field-hidden-in-dialogs'
import { migration032MoneyQuoting } from './migrations/032-money-quoting'
import { migration033ExternalIdFieldHiddenInDialogs } from './migrations/033-external-id-field-hidden-in-dialogs'
import { migration034QuotePdfAssetField } from './migrations/034-quote-pdf-asset-field'
import { migration035MoneyInvoicing } from './migrations/035-money-invoicing'
import { migration036InvoicePublicToken } from './migrations/036-invoice-public-token'
import { migration037WorkOrderEngagementStatuses } from './migrations/037-work-order-engagement-statuses'
import { migration038InvoiceAutomation } from './migrations/038-invoice-automation'
import { migration039WorkOrderTags } from './migrations/039-work-order-tags'
import { migration040CatalogGroup } from './migrations/040-catalog-group'
import { migration041QuoteAcceptanceFields } from './migrations/041-quote-acceptance-fields'
import { migration042QuoteDepositFields } from './migrations/042-quote-deposit-fields'
import { migration043WorkOrderBillingAllocations } from './migrations/043-work-order-billing-allocations'
import { migration044LinePricingFields } from './migrations/044-line-pricing-fields'
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
  migration015BackfillFieldUpdatedEventData,
  migration016StripLegacyContactIdFromFieldUpdated,
  migration017ContactJobTitle,
  migration018ArticleTags,
  migration019TagScope,
  migration020ArticleNewFields,
  migration021SignatureFieldsPrefix,
  migration022InboxVisualRef,
  migration023ContactVisitorGeoFields,
  migration024ThreadVisitFields,
  migration025InboxDefaultLens,
  migration026InboxPersonalFields,
  migration027PartsV2,
  migration028PartImageAvatar,
  migration029WorkOrder,
  migration030ServiceRequest,
  migration031DocumentsFieldHiddenInDialogs,
  migration032MoneyQuoting,
  migration033ExternalIdFieldHiddenInDialogs,
  migration034QuotePdfAssetField,
  migration035MoneyInvoicing,
  migration036InvoicePublicToken,
  migration037WorkOrderEngagementStatuses,
  migration038InvoiceAutomation,
  migration039WorkOrderTags,
  migration040CatalogGroup,
  migration041QuoteAcceptanceFields,
  migration042QuoteDepositFields,
  migration043WorkOrderBillingAllocations,
  migration044LinePricingFields,
]

/**
 * The full ordered registry of entity migrations. Exposed so the data-migrations
 * framework can wrap each one as a registered `DataMigrationDef` (see
 * `@auxx/lib/data-migrations`).
 */
export const ALL_ENTITY_MIGRATIONS: readonly EntityMigration[] = ALL_MIGRATIONS

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

/**
 * Run a single entity migration across every organization.
 *
 * The transpose of {@link runEntityMigrationsForOrg} (one migration × all orgs vs.
 * all migrations × one org): the data-migrations framework drives each registered
 * migration independently, so it needs this shape. Preserves the per-org cache
 * invalidation and the global flush of the per-all-orgs runner.
 *
 * Partial failure: collects per-org errors, runs the remaining orgs, then THROWS the
 * aggregate so the ledger marks the migration `failed`. Retry is safe and cheap —
 * succeeded orgs no-op via their own idempotency checks, only failed orgs redo work.
 */
export async function runEntityMigrationForAllOrgs(
  db: Database,
  migration: EntityMigration
): Promise<void> {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)

  logger.info(`Running entity migration ${migration.id} for ${orgs.length} organizations`)

  const errors: string[] = []
  let totalCreated = 0

  for (const org of orgs) {
    try {
      const result = await migration.up(db, org.id)
      if (!result.alreadyUpToDate) {
        totalCreated += result.entityDefsCreated + result.fieldsCreated
        // Recompute this org's entity/field caches so it picks up the new definitions
        await getOrgCache().invalidateAndRecompute(org.id, [
          'entityDefs',
          'entityDefSlugs',
          'customFields',
          'resources',
        ])
        logger.info(`Migration ${migration.id} applied`, {
          organizationId: org.id,
          entityDefsCreated: result.entityDefsCreated,
          fieldsCreated: result.fieldsCreated,
          relationshipsLinked: result.relationshipsLinked,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Migration ${migration.id} failed for org`, {
        organizationId: org.id,
        error: message,
      })
      errors.push(`${org.id}: ${message}`)
    }
  }

  // Belt-and-braces global flush so every org picks up new definitions
  if (totalCreated > 0) {
    logger.info('Flushing entity and field caches for all orgs')
    await getOrgCache().flushKeyForAllOrgs([
      'entityDefs',
      'entityDefSlugs',
      'customFields',
      'resources',
    ])
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration ${migration.id} failed for ${errors.length} org(s):\n${errors.join('\n')}`
    )
  }
}

/** List all registered migrations */
export function listEntityMigrations(): { id: string; description: string }[] {
  return ALL_MIGRATIONS.map((m) => ({ id: m.id, description: m.description }))
}

export type { EntityMigration, EntityMigrationResult, MigrationRunResult } from './types'
