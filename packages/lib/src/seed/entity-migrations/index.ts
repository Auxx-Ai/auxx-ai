// packages/lib/src/seed/entity-migrations/index.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
// Deep path, not the `../../data-migrations` barrel: that barrel re-exports
// `wrapEntityMigration`, which imports THIS module — a barrel import here would
// close the cycle. `describe-migration-error.ts` itself imports nothing.
import {
  describeMigrationError,
  MAX_SUMMARY_LENGTH,
} from '../../data-migrations/describe-migration-error'
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
import { migration045DefaultEntityDashboards } from './migrations/045-default-entity-dashboards'
import { migration046LayeredDefaultViews } from './migrations/046-layered-default-views'
import { migration047LineItemSourceLine } from './migrations/047-line-item-source-line'
import { migration048ScoutingPhotoFields } from './migrations/048-scouting-photo-fields'
import { migration057RemoveSignatureVisibilityField } from './migrations/057-remove-signature-visibility-field'
import { migration059PersonalInboxDef } from './migrations/059-personal-inbox-def'
import { migration062RemoveInboxLensPersonalFields } from './migrations/062-remove-inbox-lens-personal-fields'
import { migration074TagAiClassify } from './migrations/074-tag-ai-classify'
import { migration075TagTemplateKey } from './migrations/075-tag-template-key'
import { migration100PartCostProvenance } from './migrations/100-part-cost-provenance'
import { migration101ProductFamily } from './migrations/101-product-family'
import { migration102CatalogRelabel } from './migrations/102-catalog-relabel'
import { migration104VendorSkuOptional } from './migrations/104-vendor-sku-optional'
import { migration106SupplierPricingRelabel } from './migrations/106-supplier-pricing-relabel'
import { migration107Order } from './migrations/107-order'
import { migration108Purchasing } from './migrations/108-purchasing'
import { migration109BuildAndStandardCost } from './migrations/109-build-and-standard-cost'
import { migration110BuildVisible } from './migrations/110-build-visible'
import { migration111OrderBuildDrift } from './migrations/111-order-build-drift'
import { migration112RecordDocuments } from './migrations/112-record-documents'
import { migration114RetireGlPostingDefs } from './migrations/114-retire-gl-posting-defs'
import { migration115VendorPartDisplayPart } from './migrations/115-vendor-part-display-part'
import { migration116PerPartAbsorption } from './migrations/116-per-part-absorption'
import { migration117PartKindFromBom } from './migrations/117-part-kind-from-bom'
import { migration118MovementTypeRelabel } from './migrations/118-movement-type-relabel'
import { migration119TariffSchedule } from './migrations/119-tariff-schedule'
import { migration120TariffCodeLabel } from './migrations/120-tariff-code-label'
import { migration121RatePrecision } from './migrations/121-rate-precision'
import { migration122OrderShippingAndNote } from './migrations/122-order-shipping-and-note'
import type { EntityMigration, MigrationRunResult } from './types'

const logger = createScopedLogger('entity-migrations')

/**
 * Per-org failure lines quoted verbatim in the aggregate thrown by
 * {@link runEntityMigrationForAllOrgs}. A migration that fails on one org
 * usually fails on all of them for the same reason, so the first few lines
 * carry the whole diagnosis and lines 6..N are just N copies of it — bounded
 * here so an org count, not a bug, can never inflate the message.
 */
const MAX_QUOTED_ORG_FAILURES = 5

const TRUNCATION_MARKER = '…[truncated]'

/** Hard bound — the result never exceeds `max`, marker included. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

/**
 * Render the multi-org failure list for the aggregate error message.
 *
 * Two independent bounds, because each per-org line is already a
 * {@link describeMigrationError} summary capped at {@link MAX_SUMMARY_LENGTH}:
 * quoting every org would make the aggregate `orgs × 2 KB`. The line count is
 * capped first, then the whole message is capped at {@link MAX_SUMMARY_LENGTH}
 * so it matches what the ledger will actually store. The header carries the
 * *count* and is emitted before the truncation point, so "how many orgs failed"
 * survives no matter how verbose one org's error was.
 */
function buildAggregateFailureMessage(migrationId: string, failures: string[]): string {
  const header = `Migration ${migrationId} failed for ${failures.length} org(s):`
  const quoted = failures.slice(0, MAX_QUOTED_ORG_FAILURES)
  const omitted = failures.length - quoted.length
  const lines = omitted > 0 ? [...quoted, `…and ${omitted} more org(s)`] : quoted

  return `${header}\n${truncate(lines.join('\n'), MAX_SUMMARY_LENGTH - header.length - 1)}`
}

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
  migration045DefaultEntityDashboards,
  migration046LayeredDefaultViews,
  migration047LineItemSourceLine,
  migration048ScoutingPhotoFields,
  // 049–056 are pure data migrations (`data-migrations/migrations/`) — the NNN
  // id space is shared across both directories, so the gap is expected.
  migration057RemoveSignatureVisibilityField,
  // 058 is a pure data migration (`data-migrations/migrations/`).
  migration059PersonalInboxDef,
  // 060 (personal-inbox move) and 061 (inboxes member-baseline backfill) are
  // pure data migrations. 062 MUST sort after 060 — it drops the two fields 060
  // reads. See the ordering note in the migration itself.
  migration062RemoveInboxLensPersonalFields,
  // 063–073 are pure data migrations (`data-migrations/migrations/`) — the NNN id
  // space is shared across both directories, so the gap is expected.
  migration074TagAiClassify,
  migration075TagTemplateKey,
  // 076–099 are pure data migrations (`data-migrations/migrations/`) — the NNN id
  // space is shared across both directories, so the gap is expected.
  migration100PartCostProvenance,
  migration101ProductFamily,
  migration102CatalogRelabel,
  // 103 (gl-posting def) was REMOVED, not renumbered — the id space is shared
  // and its ledger row stays `applied`. 114 retires what it created.
  migration104VendorSkuOptional,
  migration106SupplierPricingRelabel,
  migration107Order,
  migration108Purchasing,
  migration109BuildAndStandardCost,
  // MUST sort after 109 — it flips the def 109 creates. See the migration itself
  // for why the `SYSTEM_ENTITIES` edit alone reaches no existing org.
  migration110BuildVisible,
  migration111OrderBuildDrift,
  // MUST sort after 108 — it converts four fields 108 creates, and
  // `ensureCustomFields` is INSERT-only so 108 itself can never do it.
  migration112RecordDocuments,
  // MUST sort after 103 and 108 — it deletes the two defs they created. Both
  // have been gutted of that work, so this is a no-op on a fresh database.
  migration114RetireGlPostingDefs,
  // MUST sort after 001 — it repoints display fields 001 creates. The
  // `DISPLAY_FIELD_CONFIG` edit that ships with it reaches fresh orgs only,
  // because `linkDisplayFields` runs at seed time.
  migration115VendorPartDisplayPart,
  migration116PerPartAbsorption,
  // MUST sort after 116 — it turns on conversion-cost absorption for the parts it
  // promotes, which changes the inputs 116's per-part rates resolve against.
  migration117PartKindFromBom,
  migration118MovementTypeRelabel,
  // MUST sort after 001 - it hangs `vendor_part.tariffCode` off the def 001
  // creates, and skips an org that has not reached 001 yet.
  migration119TariffSchedule,
  // MUST sort after 119 - it adds a derived field to the def 119 creates and
  // repoints that def's display field at it.
  migration120TariffCodeLabel,
  migration121RatePrecision,
  migration122OrderShippingAndNote,
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
      // Not `error.message`: anything Drizzle throws says only `Failed query: …`,
      // while the SQLSTATE code, constraint, table and column that explain WHY sit
      // on `.cause`. `describeMigrationError` walks the chain, lifts those fields
      // and drops the bound query params (customer data) from the stored text.
      const { summary, pg } = describeMigrationError(error)
      logger.error(`Migration ${migration.id} failed`, { organizationId, error: summary, ...pg })
      result.error = `${migration.id}: ${summary}`
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
  /** The raw first failure, kept as the `cause` of the aggregate below. */
  let firstError: unknown
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
      // Same reason as in `runEntityMigrationsForOrg`: the recorded line must name
      // the pg error, not Drizzle's `Failed query: …` wrapper.
      const { summary, pg } = describeMigrationError(error)
      logger.error(`Migration ${migration.id} failed for org`, {
        organizationId: org.id,
        error: summary,
        ...pg,
      })
      if (errors.length === 0) firstError = error
      errors.push(`${org.id}: ${summary}`)
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
    // Both halves are needed, and they fix different things:
    //  - the message quotes `describeMigrationError` summaries, so a human reading
    //    the ledger row or the script output sees the pg code/constraint per org;
    //  - `cause` keeps the ORIGINAL error object on the chain. This aggregate is
    //    what `wrapEntityMigration` hands to `runPendingDataMigrations`, which
    //    re-describes it; a causeless `new Error(...)` severs the chain there and
    //    the runner's unwrapping recovers nothing for all ~50 wrapped entity
    //    migrations. The first failure is the cause because a migration that
    //    breaks on one org almost always breaks on the rest identically.
    throw new Error(buildAggregateFailureMessage(migration.id, errors), { cause: firstError })
  }
}

/** List all registered migrations */
export function listEntityMigrations(): { id: string; description: string }[] {
  return ALL_MIGRATIONS.map((m) => ({ id: m.id, description: m.description }))
}

export type { EntityMigration, EntityMigrationResult, MigrationRunResult } from './types'
