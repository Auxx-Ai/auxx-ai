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
import { migration153FulfillmentLines } from './migrations/153-fulfillment-lines'
import { migration154Returns } from './migrations/154-returns'
import { migration155ReturnInboundTrackingMulti } from './migrations/155-return-inbound-tracking-multi'
import { migration156PaymentGatewayFeeTreatment } from './migrations/156-payment-gateway-fee-treatment'
import { migration157PayoutRailAndOrderPaymentFields } from './migrations/157-payout-rail-and-order-payment-fields'
import { migration159VendorBillLineVendorCode } from './migrations/159-vendor-bill-line-vendor-code'
import { migration160GatewaySettlementFields } from './migrations/160-gateway-settlement-fields'
import { migration161FinancialRecordFields } from './migrations/161-financial-record-fields'
import { migration162OrderPaymentEvidence } from './migrations/162-order-payment-evidence'
import { migration163FinancialSourceFields } from './migrations/163-financial-source-fields'
import { migration164CreditApplicationHistory } from './migrations/164-credit-application-history'
import { migration165AccountSubtypeClearing } from './migrations/165-account-subtype-clearing'
import { migration166OneMappingTable } from './migrations/166-one-mapping-table'
import { migration167DocumentAttachments } from './migrations/167-document-attachments'
import { migration168RemoveGlPostingStampFields } from './migrations/168-remove-gl-posting-stamp-fields'
import { migration169RemovePaymentEntity } from './migrations/169-remove-payment-entity'
import { migration170GlAccountParentField } from './migrations/170-gl-account-parent-field'
import { migration171OneCashEndpoint } from './migrations/171-one-cash-endpoint'
import { migration172VendorBillMatchStatus } from './migrations/172-vendor-bill-match-status'
import { migration173PartStandardCostSource } from './migrations/173-part-standard-cost-source'
import { migration175StockMovementAccruals } from './migrations/175-stock-movement-accruals'
import { migration177VendorBillLineLandedBill } from './migrations/177-vendor-bill-line-landed-bill'
import { migration178VendorCreditLineReturnsStock } from './migrations/178-vendor-credit-line-returns-stock'
import { migration179RemovePurchaseOrderTaxRecoverable } from './migrations/179-remove-purchase-order-tax-recoverable'
import { migration180CustomerTransactionGatewayIds } from './migrations/180-customer-transaction-gateway-ids'
import { migration181RewalkProvisionedChartPacks } from './migrations/181-rewalk-provisioned-chart-packs'
import { migration182VendorBillAmountDiscounted } from './migrations/182-vendor-bill-amount-discounted'
import { migration183EntityDefPalette } from './migrations/183-entity-def-palette'
import { migration186DropPostingMarkers } from './migrations/186-drop-posting-markers'
import { migration187JournalEntryLine } from './migrations/187-journal-entry-line'
import { migration188CreditMemoMoneyPending } from './migrations/188-credit-memo-money-pending'
import { migration189ThreadTriageFields } from './migrations/189-thread-triage-fields'
import { migration190PartsAndServices } from './migrations/190-parts-and-services'
import { migration191PartSellingFields } from './migrations/191-part-selling-fields'
import { migration192RemoveCatalogItem } from './migrations/192-remove-catalog-item'
import { migration193PartChannelCost } from './migrations/193-part-channel-cost'
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
const RETIRED_ID_NUMBERS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 150 }, (_, i) => String(i + 1).padStart(3, '0')),
  // The two marker migrations 186 undoes; their registry fields are gone.
  '184',
  '185',
])

/**
 * Per-org migrations, authored as {@link PerOrgMigration} (see ./per-org.ts) and
 * adapted into the one registry below.
 *
 * All eight survivors are already `applied` everywhere; they are kept as worked
 * examples of the shapes, not because anything still needs them. See
 * ./migrations/README.md.
 */
export const PER_ORG_MIGRATIONS: PerOrgMigration[] = [
  migration160GatewaySettlementFields,
  migration161FinancialRecordFields,
  migration162OrderPaymentEvidence,
  migration163FinancialSourceFields,
  migration164CreditApplicationHistory,
  migration165AccountSubtypeClearing,
  // Deletes six fields, retypes one from TEXT to TAGS (copying its values from
  // valueText to optionId in the same pass), and widens with a seventh: the
  // one-migration-does-everything shape (plans/accounting/tasks/58-one-mapping-table.md §4.8).
  migration166OneMappingTable,
  // Adds one INSERT-only field to four existing defs: the everyday widening shape.
  migration167DocumentAttachments,
  // Removes the six GL-posting stamp fields step 1b retires: the removal shape,
  // one raw CustomField delete per (entityType, systemAttribute) pair, gated on
  // the def existing and the row still being there.
  migration168RemoveGlPostingStampFields,
  // Finishes retiring the hidden `payment` entity (MIGRATION.md follow-up 9):
  // drops invoice.payments and bank_deposit.payments, archives the payment def
  // and any leftover instance - the removal shape again, widened to a def.
  migration169RemovePaymentEntity,
  // Adds the self-referential parent / children relationship pair to the
  // existing gl_account def: the same widen-and-link shape as 149, narrowed
  // to one def (plans/accounting/CHART-HIERARCHY.md D1).
  migration170GlAccountParentField,
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
  // Drops a field of one type and recreates it under the SAME name as another
  // type, alongside two new defs and three widened existing ones: the
  // type-change shape (plans/money/tasks/55-shipment-lines.md).
  migration153FulfillmentLines,
  // Three new defs at once plus SEVEN new halves across six existing defs, one
  // of them self-referential: the widest relationship graph any migration here
  // has linked (plans/money/tasks/54-returns.md).
  migration154Returns,
  // One boolean on one field's options: the smallest shape in this directory,
  // and the one where the registry and the migration are most likely to drift
  // apart silently (plans/money/tasks/57-return-intake-wizard.md §8.1).
  migration155ReturnInboundTrackingMulti,
  // Two new fields on an existing def AND a value stamped onto every existing
  // record in the same pass: the seed-and-stamp shape. A SINGLE_SELECT whose
  // options arrive with the field, because a select seeded without them renders
  // blank (plans/accounting/tasks/26-a-clearing-account-per-rail.md §10).
  migration156PaymentGatewayFeeTreatment,
  // Two halves that skip independently, in one id: two relationship pairs
  // across THREE existing defs in one field map plus a select stamped onto every
  // existing payout (the widen-and-link shape,
  // plans/accounting/tasks/27-a-settlement-from-anywhere.md §6.1), and three
  // fields on the order def with NOTHING stamped (the pure widen shape; the paid
  // date of an existing order is not knowable from anything the platform holds,
  // plans/accounting/tasks/29-clearing-at-the-payment-date.md §4.3). Supersedes
  // the two same-day drafts 157-payout-rail-and-source and
  // 158-order-payment-stamp-and-paid-fields.
  migration157PayoutRailAndOrderPaymentFields,
  // One TEXT field on `vendor_bill_line`, nothing stamped: the pure widen
  // shape (plans/money/tasks/58-vendor-bill-from-the-invoice.md §7.1). The
  // vendor's own printed code for the line, never the same field as the
  // part's SKU, and never backfilled because nothing has ever written it.
  migration159VendorBillLineVendorCode,
  // The whole of the one-cash-endpoint branch, per org, in one id: the vendor
  // bill status split (73 D1), the removal of the inert vendor_payment pair
  // (71 U5), and the vendor_credit def with its two owned children (71 U7).
  migration171OneCashEndpoint,
  // One SINGLE_SELECT on an existing def, plus a value remap off a neighbouring
  // field and that field's option list re-materialised: the split shape
  // (plans/accounting/tasks/done/73-the-buy-side-against-the-ledger.md §1.3 D1).
  migration172VendorBillMatchStatus,
  // One SINGLE_SELECT on the existing `part` def, no backfill: where a frozen
  // standard came from, so the first receipt of a typed guess replaces it
  // instead of varying against it (73 §6.4).
  migration173PartStandardCostSource,
  // Three fields on the existing `stock_movement` def, no backfill: what a
  // receipt credited the freight and duties accruals, and the rate behind it
  // (73 §7.2).
  migration175StockMovementAccruals,
  // One relationship pair on two existing defs, no backfill: the goods bill a
  // carrier's or broker's landed-cost line was charged against (73 §7.2).
  migration177VendorBillLineLandedBill,
  // One CHECKBOX on the existing `vendor_credit_line` def, no backfill: whether
  // issuing the line sends the goods back (73 §8.2).
  migration178VendorCreditLineReturnsStock,
  // One CHECKBOX off the existing `purchase_order` def and its values with it:
  // the flag nothing ever read, tax on a bill being an expense (74 §5, 74-D8).
  migration179RemovePurchaseOrderTaxRecoverable,
  // Two TEXT fields on the existing `customer_transaction` def, no backfill: the
  // gateway's authorisation code and its own transaction id, which is what joins
  // an Authorize.net batch member to a Shopify order (authorize-net plan §6).
  migration180CustomerTransactionGatewayIds,
  // Re-walks every chart pack an org has PARTLY adopted, landing the catalogue
  // accounts added since it was provisioned: the drift shape. Not a widening —
  // it writes entity instances through the idempotent chart seeder, not fields
  // (75 §1.3, 75-D2).
  migration181RewalkProvisionedChartPacks,
  // One CURRENCY field on the existing `vendor_bill` def, no backfill: the
  // early-payment discount's mirror 74 declared and never provisioned
  // (75 §1.4, 75-D3).
  migration182VendorBillAmountDiscounted,
  migration183EntityDefPalette,
  // Drops the five marker fields 184 and 185 added (and `payout_blocked_reason`):
  // parked work is an `AccountingWorkItem` row now (91 §4.6).
  migration186DropPostingMarkers,
  // The manual journal holds its own lines as `journal_entry_line` children (91 D5).
  migration187JournalEntryLine,
  // One CHECKBOX on the existing `credit_memo` def, no backfill: a channel refund whose
  // money is still pending, which holds the memo back from issuing (101 E9).
  migration188CreditMemoMoneyPending,
  // Four dbColumn-backed fields on the existing `thread` def, no backfill: the triage
  // mail classification writes (decision 03 §5.2).
  migration189ThreadTriageFields,
  // Relabels the part def and appends `part_kind`'s `service` option (107 D1, D2).
  migration190PartsAndServices,
  // Four fields on the existing `part` def, no backfill: the part is the sell-side register (107).
  migration191PartSellingFields,
  // Deletes the catalog_item def and its relationship sides: the part is the one register (107 D1).
  migration192RemoveCatalogItem,
  // Two fields on the existing `part` def, no backfill: a channel's unit cost seeds the first
  // standard, and the standard records which door wrote it (106 D5, D9).
  migration193PartChannelCost,
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
