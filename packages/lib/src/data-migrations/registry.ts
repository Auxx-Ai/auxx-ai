// packages/lib/src/data-migrations/registry.ts

import { migration045DefaultEntityDashboards } from './migrations/045-default-entity-dashboards'
import { migration099ImapBackfillStamps } from './migrations/099-imap-backfill-stamps'
import { migration118MovementTypeRelabel } from './migrations/118-movement-type-relabel'
import { migration131ReseedPlatformProvidersBankFeed } from './migrations/131-reseed-platform-providers-bank-feed'
import { migration147BackfillBankMatchKeys } from './migrations/147-backfill-bank-match-keys'
import { migration148RecurringJournalEntries } from './migrations/148-recurring-journal-entries'
import { migration149ShipmentParcel } from './migrations/149-shipment-parcel'
import { migration150StripLegacyAddressComponents } from './migrations/150-strip-legacy-address-components'
import { migration151ShipmentLabelCostAndDocument } from './migrations/151-shipment-label-cost-and-document'
import { migration152CreditMemoGlPosting } from './migrations/152-credit-memo-gl-posting'
import { type PerOrgMigration, perOrgMigration } from './per-org'
import { assertUniqueMigrationIds } from './plan'
import type { DataMigrationDef } from './types'

/** The eight ids from the retired range that are still registered. */
const KEPT_IDS: ReadonlySet<string> = new Set([
  '045-default-entity-dashboards',
  '099-imap-backfill-stamps',
  '118-movement-type-relabel',
  '131-reseed-platform-providers-bank-feed',
  '147-backfill-bank-match-keys',
  '148-recurring-journal-entries',
  '149-shipment-parcel',
  '150-strip-legacy-address-components',
])

/**
 * Ids 001 to 150 were RETIRED on 2026-09-11 — applied in every live database, then
 * deleted. `KEPT_IDS` names the eight kept as worked examples.
 *
 * The ledger keeps a retired migration's row forever, which is harmless: the runner
 * walks the REGISTRY and looks the ledger up by id, so a row with no entry is simply
 * never read. This list exists for one reason only — an id is a permanent ledger key
 * and **must never be reused**. A new `042` would be skipped, silently and with no
 * error, by every database that already ran the old one. The deleted files are in git
 * history if you need to read one.
 */
const RETIRED_ID_NUMBERS: ReadonlySet<string> = new Set(
  Array.from({ length: 150 }, (_, i) => String(i + 1).padStart(3, '0'))
)

/**
 * Per-org migrations, authored as {@link PerOrgMigration} (see ./per-org.ts) and
 * adapted into the one registry below.
 *
 * All eight survivors are already `applied` everywhere; they are kept as worked
 * examples of the shapes, not because anything still needs them. See
 * ./migrations/README.md.
 */
export const PER_ORG_MIGRATIONS: PerOrgMigration[] = [
  // Re-seeds the default entity dashboards. The one entry here that is NOT just an
  // example: `apps/worker/scripts/reseed-default-dashboard.ts` re-runs its ensure
  // after a `DEFAULT_DASHBOARD_CONFIGS` template change, so it is a live routine.
  migration045DefaultEntityDashboards,
  // Relabels select options without rewriting a stored `value` key — `FieldValue.optionId`
  // holds that key, so rewriting one silently orphans every row using it.
  migration118MovementTypeRelabel,
  // Adds a select option plus fields to an existing def: the everyday shape.
  migration148RecurringJournalEntries,
  // Creates new defs, their fields, and an inverse relationship: the richest shape.
  migration149ShipmentParcel,
  // Mutates `CustomField.options` on fields that already exist: the cleanup shape.
  migration150StripLegacyAddressComponents,
  // Adds four fields to the `shipment` def 149 created: label cost, insurance cost,
  // insurance claim and the label PDF URL.
  migration151ShipmentLabelCostAndDocument,
  // Adds a field AND backfills it from another table in the same pass: the stamp
  // shape. The INSERT-only `ensureCustomFields` writes no values, so a field whose
  // absence means "unposted" needs its history written or every already-posted
  // record reads as unposted.
  migration152CreditMemoGlPosting,
  // Recomputes a stored column from its own source with the current algorithm:
  // the backfill shape.
  migration147BackfillBankMatchKeys,
]

/**
 * Build the registry of all available data migrations, sorted by id.
 *
 * Two authoring shapes, one registry: per-org migrations from {@link PER_ORG_MIGRATIONS}
 * adapted via {@link perOrgMigration}, plus whole-database ones authored as
 * `migrations/NNN-slug.ts` exporting a `DataMigrationDef` and appended below. Both
 * share one global id sequence, because order matters across the two shapes and
 * fail-stop enforces it.
 */
function buildRegistry(): DataMigrationDef[] {
  const all: DataMigrationDef[] = [
    ...PER_ORG_MIGRATIONS.map(perOrgMigration),
    // Walks one table and stamps rows, with the DECISION split out as a pure
    // exported function its unit test drives without a database: the backfill shape.
    migration099ImapBackfillStamps,
    // Re-upserts the platform `ConnectionDefinition` rows by calling the live
    // idempotent seeder: the smallest useful whole-database migration.
    migration131ReseedPlatformProvidersBankFeed,
  ]

  all.sort((a, b) => a.id.localeCompare(b.id))

  // Fail loud at module load if two migrations claim the same id, or if one
  // reuses a retired id.
  assertUniqueMigrationIds(all)
  for (const migration of all) {
    const number = migration.id.split('-')[0] ?? ''
    if (RETIRED_ID_NUMBERS.has(number) && !KEPT_IDS.has(migration.id)) {
      throw new Error(
        `Data migration ${migration.id} reuses retired id ${number}. Ids are permanent ledger keys — pick the next free number.`
      )
    }
  }

  return all
}

export const ALL_DATA_MIGRATIONS: DataMigrationDef[] = buildRegistry()
