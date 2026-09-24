// packages/lib/scripts/reset-org-books.ts
//
// 🛑 DEV-ONLY. Returns one organization's TRANSACTIONAL state to zero so the
// whole money + inventory flow can be driven again from scratch: the ledger,
// every accounting document, the money model and its source evidence, orders,
// builds, movements, purchasing, the sales pipeline, record numbering, connector
// bindings, the QuickBooks map plus every QuickBooks id held on kept records, and
// the accounting configuration: the chart, its role map, bank accounts, bank rules
// and payment gateways (`--keep-config` keeps those).
//
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/reset-org-books.ts DemoOrg1
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/reset-org-books.ts DemoOrg1 --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// ── What this KEEPS, and why that is the whole point ────────────────────────
//
// Parts, subparts, vendor parts, tariff codes and rates, the catalog, products,
// contacts, companies, tickets, inboxes, `FinancialSourceAccount` (the store
// scope, with its gateway link cleared) and the QuickBooks OAuth credential.
// Nothing accounting-configuration-shaped survives: the wizard re-creates the
// chart and the default gateway, and the bank feeds re-create the bank accounts.
//
// The money model and the source-evidence lane go WITH the documents: evidence is
// keyed on the connector's external ids, so a surviving observation makes the
// re-sync see an unchanged hash and never re-resolve the order it points at.
//
// Only the bindings of deleted records go, so a kept record stays bound and the
// re-crawl skips it. Catalog items depend on that: they have no identity to re-link by.
//
// ── Why this is not `reset-accounting.ts` ───────────────────────────────────
//
// That script clears `GlPosting`, the QuickBooks map and the wizard settings —
// the ledger slice, and nothing else. Everything the ledger was computed FROM
// survives it: 205 orders, 27 builds, 40 stock movements, the purchasing
// documents, the record counters. Re-driving against that leftover state is not
// a retest, it is a second pass over the same data with the evidence removed.
// This script is the whole closure; `reset-accounting.ts` stays as the narrow
// tool for unwedging a claimed period.
//
// ── Order is forced by four different mechanisms, not by taste ──────────────
//
// 1. **`GlPosting` first, descending `revision`.** `reversesId` is ON DELETE
//    RESTRICT, so a reversal has to go before the row it reverses. A reversal
//    always claims a revision above its original, so ordering the whole set by
//    revision descending is sufficient. `GlPostingLine` cascades.
// 2. **The Drizzle side tables before the instances they point at.** The money
//    and evidence tables carry NO ACTION composite FKs into `EntityInstance`
//    (orders, invoices, credit memos) and into each other, and `MoneyTransfer` /
//    `ProcessorBalanceEntry` share their id with the `payout` /
//    `processor_balance_entry` instance. Nothing cascades them, so the instance
//    delete fails partway. `MONEY_TABLES` spells out their order.
// 3. **Instances deepest-first.** Children before parents, so a sweep never
//    runs against a parent that is already gone.
// 4. **`DataConnectorItem` explicitly, for deleted records only.** Its two
//    instance pointers are ON DELETE **SET NULL**, not cascade. Left alone, the
//    binding survives the record with a NULL instance and its `contentHash` still
//    matches, so the next sync counts the record `skipped` and re-creates nothing.
// 5. **The configuration after the waves, the chart last.** `GlRoleAssignment` and
//    `FinancialSourceAccount.paymentGatewayId` are NO ACTION FKs into the gateway
//    instance; the QuickBooks map is a cell on the `gl_account` row, cleared first
//    so its `RecordIdentity` mirror goes with it; the chart's TEXT pointers are
//    cleared and then proven gone by `findGlAccountPointers`, as `reset-accounting.ts
//    --chart` does.
//
// ── This deliberately bypasses every pre-delete guard ───────────────────────
//
// `deleteEntityInstances` is the low-level set delete: it sweeps `FieldValue`
// on BOTH ends of every relation plus the record's `TimelineEvent` rows, and
// `RecordIdentity` cascades behind it. The guard chain lives one layer up in
// `bulkDeleteEntities`, and every guard would refuse this reset on purpose — a
// posted journal entry, an invoice carrying a GL entry, a build with a
// reversal, an order with a ledger entry against it. Those refusals are correct
// in the product and wrong in a dev reset, which is why this is a script.
//
// ── Quantity on hand is re-derived here, not by the trigger ─────────────────
//
// `recalculatePartQoH` resolves the affected part from the movement's own
// `FieldValue` rows, and `deleteEntityInstances` has already swept them by the
// time the lifecycle event lands — the handler warns out and QoH keeps the
// number the deleted ledger produced. Since EVERY movement goes, the answer is
// known without a re-SUM: zero, and `out_of_stock` by `deriveStockStatus`.

import { inspect } from 'node:util'
import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { listChartAccounts } from '../src/accounting/ledger'
import {
  findGlAccountPointers,
  GL_ACCOUNT_POINTER_ATTRIBUTES,
} from '../src/accounting/ledger/chart/gl-account-pointers'
import { setLockedThrough } from '../src/accounting/ledger/periods/set-locked-through'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/accounting/providers/quickbooks/account-map'
import { getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { freshBackfillState } from '../src/data-connectors/slice-orchestrator'
import { deleteEntityInstances } from '../src/entity-instances'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)

const CONFIRM = args.includes('--confirm')
const FORCE = args.includes('--force')
const KEEP_CONNECTOR_ITEMS = args.includes('--keep-connector-items')
const KEEP_QUICKBOOKS = args.includes('--keep-quickbooks')
const KEEP_CONFIG = args.includes('--keep-config')

if (!ORG_ARG) {
  console.error(
    'usage: reset-org-books.ts <organizationId|name> [options]\n\n' +
      '  options:\n' +
      "    --keep-connector-items  leave the deleted records' bindings + stream watermarks alone.\n" +
      '                            🛑 Deleted records then do NOT come back on the next\n' +
      '                            sync: the binding outlives the record with a NULL\n' +
      '                            instance and its contentHash still matches, so the\n' +
      '                            record is counted skipped and never re-created.\n' +
      '    --keep-quickbooks       do not clear the QuickBooks account map or held ids.\n' +
      '    --keep-config           keep the chart, role map, bank accounts, bank rules, gateways.\n' +
      '    --force                 past the providerEntryId guard.\n' +
      '    --confirm               actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

/**
 * The instance waves, deepest first.
 *
 * Within a wave nothing points at anything else, so order is free; between
 * waves it is not. `stock_movement`'s self-relations (parent/child,
 * reverses/reversed-by) are `FieldValue` rows rather than foreign keys and the
 * sweep clears both ends, so the whole type goes in one wave.
 */
const DELETE_WAVES: readonly (readonly string[])[] = [
  // Order children, the credit-memo closure, and the leaf children of wave-4 documents.
  // `deleteEntityInstances` does not cascade owned children, so each is listed.
  [
    'line_item',
    'tax_line',
    'credit_memo_application',
    'credit_memo_line',
    'credit_memo',
    'customer_transaction',
    'processor_balance_entry',
    'journal_entry_line',
    'fulfillment_line',
    'parcel',
    'return_part_line',
    'vendor_credit_line',
    'vendor_credit_application',
  ],
  // The shipment and return families, children first; all hang off the order.
  ['fulfillment', 'shipment', 'return_line'],
  ['return'],
  // The inventory ledger, then what wrote it.
  ['stock_movement', 'build'],
  // Purchasing: lines before documents.
  ['purchase_order_line', 'vendor_bill_line', 'purchase_order', 'vendor_bill', 'vendor_credit'],
  // The accounting documents.
  ['payment', 'invoice', 'bank_deposit', 'bank_transaction', 'payout', 'journal_entry'],
  // The sales pipeline.
  ['work_order', 'quote', 'service_request'],
  // Last: the order everything above hung from.
  ['order'],
]

/** Every type this script removes, flattened — used for counts and numbering. */
const CLEARED_TYPES = DELETE_WAVES.flat()

/**
 * The accounting configuration, in delete order: rules name a bank account by TEXT,
 * and the chart goes last because every one of the others names an account.
 */
const CONFIG_TYPES = ['payment_gateway', 'bank_rule', 'bank_account', 'gl_account'] as const

/** A 121k-id `inArray` overflows the SQL builder's stack; chunk any whole-org id list. */
function* chunked<T>(items: readonly T[], size = 5000): Generator<T[]> {
  for (let offset = 0; offset < items.length; offset += size) {
    yield items.slice(offset, offset + size)
  }
}

/**
 * Every `RecordSequence.scope` this script puts back to 0.
 *
 * Almost all of them are entity types, so `CLEARED_TYPES` covers them: the
 * scope a document numbers under is its own type, and clearing the type is what
 * makes resetting the counter correct.
 *
 * 🛑 `build_batch` is NOT an entity type, so it can never appear in
 * `DELETE_WAVES` and would never be reset on its own. It is an INTERNAL scope
 * (`records/record-numbering.ts`'s `INTERNAL_SEQUENCE_SCOPES`), numbering batch
 * build RUNS rather than records, and the runs it numbered live entirely on the
 * `build` rows that wave 2 deletes. Leaving it alone means an org with zero
 * builds opens its next batch run reading "run 14", and 45 §3's whole argument
 * is that the run number is the handle undo hangs on. See
 * plans/money/tasks/45-batch-only-builds.md §11.6.
 *
 * Listed by hand rather than spread from `INTERNAL_SEQUENCE_SCOPES`, so a later
 * internal scope that has nothing to do with the books cannot silently join
 * this reset. Every wave always runs, so `build` is always cleared and this is
 * unconditional.
 */
const CLEARED_SEQUENCE_SCOPES: readonly string[] = [...CLEARED_TYPES, 'build_batch']

/**
 * Drizzle tables cleared before the instances, all org-scoped.
 *
 * The first two carry ON DELETE RESTRICT columns against `EntityInstance` and
 * would reject the invoice / quote / work-order deletes partway through. The
 * rest cascade on their own but are listed so the dry run reports them: a
 * cascade nobody printed is a row count that appears to vanish.
 */
const SIDE_TABLES = [
  { name: 'InvoiceLineAllocation', table: schema.InvoiceLineAllocation },
  { name: 'InvoiceScheduleAllocation', table: schema.InvoiceScheduleAllocation },
  { name: 'InvoiceVisitAllocation', table: schema.InvoiceVisitAllocation },
  { name: 'WorkOrderBillingInstallment', table: schema.WorkOrderBillingInstallment },
  { name: 'WorkOrderVisit', table: schema.WorkOrderVisit },
] as const

/**
 * The money model, the evidence lane, the mirror and parked work, in delete order.
 *
 * Every FK among these is NO ACTION, so each table goes before what it points at.
 * `FinancialSourceAccount` is kept; nothing on it records sync progress.
 */
const MONEY_TABLES = [
  // → FinancialSourceObject, MoneyTransaction, MoneyCommand.
  { name: 'MoneySourceLink', table: schema.MoneySourceLink },
  // → FinancialSourceObject/Observation, MoneyTransaction, the order instance.
  { name: 'FinancialSourceAcceptance', table: schema.FinancialSourceAcceptance },
  // → MoneyTransaction, MoneyCommand, credit memo / vendor credit instances.
  { name: 'MoneyRefundSettlement', table: schema.MoneyRefundSettlement },
  // → MoneyTransaction, MoneyCommand, order / invoice / vendor bill instances. Its
  // self-FK (`reversesApplicationId`) is NO ACTION, so one statement clears both ends.
  { name: 'MoneyApplication', table: schema.MoneyApplication },
  // → MoneyCommand.
  { name: 'MoneyTransaction', table: schema.MoneyTransaction },
  { name: 'MoneyCommand', table: schema.MoneyCommand },
  // id → the payout / processor_balance_entry instance; → FinancialSourceObject/Observation.
  { name: 'MoneyTransfer', table: schema.MoneyTransfer },
  { name: 'ProcessorBalanceEntry', table: schema.ProcessorBalanceEntry },
  // → FinancialSourceObject.
  { name: 'FinancialSourceObservation', table: schema.FinancialSourceObservation },
  { name: 'FinancialSourceObject', table: schema.FinancialSourceObject },
  { name: 'FinancialSourceCoverage', table: schema.FinancialSourceCoverage },
  // No FKs in; the mirror's lines cascade.
  { name: 'ProviderLedgerEntry', table: schema.ProviderLedgerEntry },
  // A parked item would otherwise keep its source from being re-offered.
  { name: 'AccountingWorkItem', table: schema.AccountingWorkItem },
] as const

/**
 * Every key the accounting wizard, the close, the inbound sync and the
 * auto-build switch write, returned to its catalog default.
 *
 * Written through `batchUpdateOrganizationSettings` rather than deleted, so the
 * organization lands exactly where one that never opened the wizard sits and
 * still passes that function's normalization and unknown-key check.
 *
 * 🛑 `inventory.autoBuildEnabledAt` is reset WITH the boolean, and the pair
 * matters. `stampAutoBuildEnabledAt` re-stamps only on an off→on transition, so
 * leaving the switch on would keep the 2026-09 cutoff standing over re-synced
 * orders dated months earlier and silently raise no builds at all. Turning the
 * switch back on in the UI after this runs re-stamps it at that moment — which
 * still means historical Shopify orders do not auto-build, by design (AB8).
 *
 * 🛑 `accounting.providerSyncedThrough` and the two `openingSource` keys are
 * here for the reason `reset-accounting.ts`'s own list states at length: a key
 * belongs in one of these lists when deleting the postings makes its value a
 * lie, which is wider than "the wizard wrote it". The sync marker is the sharp
 * one — `marker-writes.ts` exists to stop it running ahead of what was genuinely
 * read, and a books wipe that leaves it standing puts it exactly there.
 */
const SETTING_RESETS = [
  { key: 'accounting.setupState' as const, value: 'draft' },
  { key: 'accounting.setupFinalizedAt' as const, value: null },
  { key: 'accounting.setupFinalizedByUserId' as const, value: null },
  { key: 'accounting.cutoffPeriod' as const, value: null },
  { key: 'accounting.bookTimeZone' as const, value: null },
  { key: 'accounting.openingSource' as const, value: 'manual' },
  { key: 'accounting.openingSourceAsOf' as const, value: null },
  // A leftover `true` makes Connect-and-go's Finish skip the provider opening.
  { key: 'accounting.openingFromNothing' as const, value: false },
  { key: 'accounting.providerSyncedThrough' as const, value: null },
  // The inbound mirror's walk position; the mirror rows are wiped above.
  { key: 'providerSync.state' as const, value: null },
  // `ledger.lockedThroughMonth` is guarded: only `setLockedThrough` may write it (below).
  { key: 'inventory.autoBuildFromOrders' as const, value: false },
  { key: 'inventory.autoBuildEnabledAt' as const, value: null },
  { key: 'inventory.autoBuildStockRule' as const, value: 'out_of_stock_only' },
]

const QUICKBOOKS_APP_SLUG = 'quickbooks'

function money(minor: number | bigint | null): string {
  if (minor === null) return '-'
  return `$${(Number(minor) / 100).toFixed(2)}`
}

function heading(text: string): void {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 74 - text.length))}\n`)
}

/** Resolve `<org>` as an id first, then as a name. */
async function resolveOrg(): Promise<{ id: string; name: string | null }> {
  const byId = await db.query.Organization.findFirst({
    where: (t, { eq: is }) => is(t.id, ORG_ARG),
    columns: { id: true, name: true },
  })
  if (byId) return byId

  const byName = await db.query.Organization.findMany({
    where: (t, { ilike }) => ilike(t.name, ORG_ARG),
    columns: { id: true, name: true },
    limit: 5,
  })
  if (byName.length === 1 && byName[0]) return byName[0]
  if (byName.length > 1) {
    console.error(`'${ORG_ARG}' matches ${byName.length} organizations:`)
    for (const o of byName) console.error(`  ${o.id}  ${o.name}`)
    process.exit(1)
  }
  console.error(`No organization matches '${ORG_ARG}' by id or name.`)
  process.exit(1)
}

/**
 * The org's QuickBooks installation and connection, by query rather than
 * through `resolveQuickbooksContext`.
 *
 * That helper also resolves the app DEPLOYMENT and answers `connected: false`
 * when the bundle cannot be resolved. For a tool whose whole job is cleaning up
 * after something went wrong, "the deployment is broken so I will not clear the
 * map" is the wrong failure mode. Nothing here invokes a tool.
 */
async function resolveQuickbooksConnection(
  organizationId: string
): Promise<{ installationId: string; connectionId: string } | null> {
  const install = await db
    .select({ id: schema.AppInstallation.id })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
    .where(
      and(
        eq(schema.AppInstallation.organizationId, organizationId),
        eq(schema.App.slug, QUICKBOOKS_APP_SLUG)
      )
    )
    .limit(1)

  const installationId = install[0]?.id
  if (!installationId) return null

  const credential = await db
    .select({ id: schema.Credential.id })
    .from(schema.Credential)
    .where(eq(schema.Credential.appInstallationId, installationId))
    .limit(1)

  const connectionId = credential[0]?.id
  if (!connectionId) return null

  return { installationId, connectionId }
}

/** `FieldValue ⋈ CustomField` rows holding a QuickBooks id for this connection. */
function qboIdCellFilter(organizationId: string, connectionId: string) {
  return and(
    eq(schema.FieldValue.organizationId, organizationId),
    eq(schema.CustomField.connectionId, connectionId),
    eq(schema.CustomField.isIdentity, true)
  )
}

/** Stores holding a QuickBooks summary-mode placeholder customer. */
function qboPlaceholderFilter(organizationId: string) {
  return and(
    eq(schema.FinancialSourceAccount.organizationId, organizationId),
    sql`jsonb_exists(${schema.FinancialSourceAccount.providerCustomerRef}, ${QUICKBOOKS_APP_SLUG}::text)`
  )
}

/** Instance ids per entity type, for `types`. */
async function readInstanceIds(
  organizationId: string,
  types: readonly string[]
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityDefinition.entityType, [...types])
      )
    )

  const byType = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.entityType) continue
    const group = byType.get(row.entityType) ?? []
    group.push(row.id)
    byType.set(row.entityType, group)
  }
  return byType
}

/**
 * Bindings whose record this reset deletes, or whose record is already gone.
 * Kept records keep theirs.
 */
async function readBindingIdsToDrop(
  organizationId: string,
  deletedTypes: readonly string[]
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.DataConnectorItem.id })
    .from(schema.DataConnectorItem)
    .leftJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.DataConnectorItem.entityInstanceId)
    )
    .leftJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        or(
          isNull(schema.EntityInstance.id),
          inArray(schema.EntityDefinition.entityType, [...deletedTypes])
        )
      )
    )
  return rows.map((r) => r.id)
}

/** `deleteEntityInstances`, exiting with the Postgres error when it fails. */
async function deleteInstancesOrExit(
  organizationId: string,
  ids: string[],
  what: string
): Promise<number> {
  const result = await deleteEntityInstances({ ids, organizationId })
  if (result.isOk()) return result.value.count
  // The Postgres message sits at the bottom of the cause chain; the middle is the query text.
  let root: { cause?: unknown } = result.error
  while (root.cause && typeof root.cause === 'object') root = root.cause as { cause?: unknown }
  const { message, code, detail, constraint, table } = root as Record<string, unknown>
  console.error(`\n🛑 ${what}: ${result.error.message}`)
  console.error(inspect({ message, code, detail, constraint, table }, { breakLength: 120 }))
  process.exit(1)
}

/**
 * The chart, its role map, bank accounts, bank rules and gateways, pointers first.
 *
 * Runs after the record waves, so the documents that name an account are gone and the
 * pointer sweep only has kept records left to clear.
 */
async function deleteConfiguration(
  organizationId: string,
  idsByType: ReadonlyMap<string, string[]>,
  pointerFieldIds: readonly string[]
): Promise<void> {
  // NO ACTION FK into the gateway instance (rail rows), and TEXT ids into the chart.
  await db
    .delete(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, organizationId))
  // NO ACTION FK into the gateway instance; the feed itself is the store scope and stays.
  await db
    .update(schema.FinancialSourceAccount)
    .set({ paymentGatewayId: null })
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        isNotNull(schema.FinancialSourceAccount.paymentGatewayId)
      )
    )

  for (const type of CONFIG_TYPES) {
    const ids = idsByType.get(type) ?? []
    if (type === 'gl_account') {
      if (pointerFieldIds.length > 0) {
        await db
          .delete(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              inArray(schema.FieldValue.fieldId, [...pointerFieldIds])
            )
          )
      }
      const remaining = await findGlAccountPointers(db, organizationId, ids)
      if (remaining.length > 0) {
        console.error(
          `\n🛑 STOPPING before the chart wipe. ${remaining.length} record(s) still point at an\n` +
            '   account through a field this script does not clear. Add the attribute to\n' +
            '   GL_ACCOUNT_POINTER_ATTRIBUTES and re-run; wiping now would leave a dangling id.\n'
        )
        for (const p of remaining) console.error(`   ${p.label} (${p.attribute})`)
        process.exit(1)
      }
    }
    for (const chunk of chunked(ids)) {
      await deleteInstancesOrExit(organizationId, chunk, `configuration delete failed on ${type}`)
    }
  }
}

async function main() {
  const org = await resolveOrg()

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to write)'}`)
  console.log(
    `scope        ledger + documents + orders + builds + movements + purchasing +\n` +
      `             pipeline + numbering${KEEP_CONNECTOR_ITEMS ? '' : ' + connector bindings'}` +
      `${KEEP_QUICKBOOKS ? '' : ' + QuickBooks map'}` +
      `${KEEP_CONFIG ? '' : ' +\n             chart + role map + bank accounts + bank rules + gateways'}`
  )
  console.log('keeps        parts, products, catalog, contacts, companies, tickets, inboxes,')
  console.log(
    `             FinancialSourceAccount, the QuickBooks credential${KEEP_CONFIG ? ', the configuration' : ''}\n`
  )

  // ── 1. The ledger ─────────────────────────────────────────────────────────

  heading('1. General ledger')

  const postings = await db
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      periodKey: schema.GlPosting.periodKey,
      revision: schema.GlPosting.revision,
      status: schema.GlPosting.status,
      docNumber: schema.GlPosting.docNumber,
      totalMinor: schema.GlPosting.totalMinor,
    })
    .from(schema.GlPosting)
    .where(eq(schema.GlPosting.organizationId, org.id))
    // Descending revision is also the delete order `reversesId`'s RESTRICT forces.
    .orderBy(desc(schema.GlPosting.revision))

  const [lineCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(eq(schema.GlPosting.organizationId, org.id))

  const byType = new Map<string, number>()
  for (const p of postings) byType.set(p.postingType, (byType.get(p.postingType) ?? 0) + 1)

  console.log(`GlPosting        ${postings.length} row(s), ${lineCount?.n ?? 0} line(s) cascade`)
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(22)} ${String(n).padStart(4)}`)
  }

  const sentBatches = await db
    .select({
      glPostingId: schema.ExportBatchPosting.glPostingId,
      providerObjectId: schema.ExportBatch.providerObjectId,
    })
    .from(schema.ExportBatchPosting)
    .innerJoin(
      schema.ExportBatch,
      and(
        eq(schema.ExportBatch.organizationId, schema.ExportBatchPosting.organizationId),
        eq(schema.ExportBatch.id, schema.ExportBatchPosting.batchId)
      )
    )
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, org.id),
        eq(schema.ExportBatch.state, 'sent')
      )
    )
  const sentObjects = new Map(
    sentBatches.map((row) => [row.glPostingId, row.providerObjectId ?? ''])
  )
  const exportedRows = postings.filter((p) => sentObjects.has(p.id))
  if (exportedRows.length > 0 && !FORCE) {
    console.error(
      `\n🛑 REFUSING. ${exportedRows.length} posting(s) sit in a SENT export batch and are already in\n` +
        '   the accounting system. Deleting our row orphans a real journal entry over there and\n' +
        '   leaves the next close computing its delta against a snapshot the provider no longer\n' +
        '   agrees with.\n\n' +
        '   Roll the batch back in the app, or pass --force once you have deleted them by hand.\n'
    )
    for (const p of exportedRows.slice(0, 10)) {
      console.error(`   ${p.docNumber} ${money(p.totalMinor)} -> ${sentObjects.get(p.id)}`)
    }
    process.exit(1)
  }
  if (exportedRows.length > 0) {
    console.log(
      `\n⚠️  --force: deleting ${exportedRows.length} posting(s) that DID reach the provider.`
    )
  }

  // ── 2. The Drizzle side tables ────────────────────────────────────────────

  heading('2. Side tables, money model and evidence (FKs into records first)')

  const sideCounts: { name: string; n: number }[] = []
  for (const { name, table } of [...SIDE_TABLES, ...MONEY_TABLES]) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.organizationId, org.id))
    sideCounts.push({ name, n: row?.n ?? 0 })
  }
  for (const { name, n } of sideCounts) {
    console.log(`  ${name.padEnd(30)} ${String(n).padStart(5)}`)
  }
  const moneyNames = new Set<string>(MONEY_TABLES.map((t) => t.name))
  const moneyTotal = sideCounts.filter((c) => moneyNames.has(c.name)).reduce((a, c) => a + c.n, 0)

  // ── 3. The instances ──────────────────────────────────────────────────────

  heading('3. Records, deepest wave first')

  const idsByType = await readInstanceIds(org.id, CLEARED_TYPES)
  let instanceTotal = 0
  for (const [index, wave] of DELETE_WAVES.entries()) {
    const parts: string[] = []
    for (const type of wave) {
      const n = idsByType.get(type)?.length ?? 0
      instanceTotal += n
      if (n > 0) parts.push(`${type} ${n}`)
    }
    console.log(`  wave ${index + 1}  ${parts.length > 0 ? parts.join(', ') : '(nothing)'}`)
  }
  console.log(`\n  ${instanceTotal} record(s) total. FieldValue on both ends of every`)
  console.log('  relation, TimelineEvent and RecordIdentity go with them.')

  const allIds = [...idsByType.values()].flat()
  let ruleRuns = 0
  for (const chunk of chunked(allIds)) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, org.id),
          inArray(schema.RecordRuleRun.entityInstanceId, chunk)
        )
      )
    ruleRuns += row?.n ?? 0
  }
  console.log(`  RecordRuleRun ${ruleRuns} (no foreign key — cleared explicitly)`)

  // ── 4. Connector bindings ─────────────────────────────────────────────────

  heading('4. Connector bindings and stream watermarks')

  let bindingIds: string[] = []
  const streams: { id: string; streamKey: string | null; state: unknown }[] = []

  if (KEEP_CONNECTOR_ITEMS) {
    console.log('--keep-connector-items: skipped.')
    console.log('🛑 Deleted records will NOT come back on the next sync — the binding outlives')
    console.log('   the record and its contentHash still matches, so it is counted skipped.\n')
  } else {
    bindingIds = await readBindingIdsToDrop(
      org.id,
      KEEP_CONFIG ? CLEARED_TYPES : [...CLEARED_TYPES, ...CONFIG_TYPES]
    )

    const streamRows = await db
      .select({
        id: schema.DataConnectorStream.id,
        streamKey: schema.DataConnectorStream.streamKey,
        state: schema.DataConnectorStream.state,
        connectorName: schema.DataConnector.name,
      })
      .from(schema.DataConnectorStream)
      .innerJoin(
        schema.DataConnector,
        eq(schema.DataConnector.id, schema.DataConnectorStream.dataConnectorId)
      )
      .where(eq(schema.DataConnectorStream.organizationId, org.id))

    console.log(
      `DataConnectorItem  ${bindingIds.length} binding(s) of deleted records; kept records keep theirs`
    )
    console.log(`streams            ${streamRows.length} reset to a fresh backfill`)
    for (const s of streamRows) {
      const state = (s.state ?? {}) as { phase?: string; watermark?: string }
      streams.push({ id: s.id, streamKey: s.streamKey, state: s.state })
      console.log(
        `  ${(s.connectorName ?? '?').padEnd(16)} ${(s.streamKey ?? '?').padEnd(12)}` +
          ` ${(state.phase ?? 'none').padEnd(9)} watermark ${state.watermark ?? '-'}`
      )
    }
  }

  // ── 5. Quantity on hand ───────────────────────────────────────────────────

  heading('5. Part quantity on hand')

  const partFields = await db
    .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, org.id),
        inArray(schema.CustomField.systemAttribute, ['part_quantity_on_hand', 'part_stock_status'])
      )
    )
  const qohFieldId = partFields.find((f) => f.attribute === 'part_quantity_on_hand')?.id
  const statusFieldId = partFields.find((f) => f.attribute === 'part_stock_status')?.id

  let qohRows = 0
  if (qohFieldId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          eq(schema.FieldValue.fieldId, qohFieldId),
          sql`${schema.FieldValue.valueNumber} IS DISTINCT FROM 0`
        )
      )
    qohRows = row?.n ?? 0
  }
  console.log(`  ${qohRows} part(s) hold a non-zero quantity -> 0, stock status -> out_of_stock`)
  console.log('  (every movement is going, so the re-SUM is known without running it)')

  // ── 6. The QuickBooks account map ─────────────────────────────────────────

  heading('6. QuickBooks account map')

  let mappings: { glAccountId: string; code: string; name: string; providerAccountId: string }[] =
    []
  let connection: { installationId: string; connectionId: string } | null = null
  let qboIdentityRows = 0
  let qboIdCells = 0
  let qboPlaceholders = 0

  if (KEEP_QUICKBOOKS) {
    console.log('--keep-quickbooks: skipped.')
  } else {
    connection = await resolveQuickbooksConnection(org.id)
    if (!connection) {
      console.log('no QuickBooks connection for this org — nothing to clear')
    } else {
      const map = await readQuickbooksAccountMap({ organizationId: org.id, ...connection })
      const chart = await listChartAccounts(db, org.id)
      const byId = new Map(chart.isOk() ? chart.value.map((a) => [a.id, a] as const) : [])

      mappings = [...map.entries()].map(([glAccountId, providerAccountId]) => ({
        glAccountId,
        code: byId.get(glAccountId)?.code ?? '????',
        name: byId.get(glAccountId)?.name ?? '(not in the live chart)',
        providerAccountId,
      }))
      mappings.sort((a, b) => a.code.localeCompare(b.code))

      if (mappings.length === 0) {
        console.log('account map: empty')
      } else {
        console.log(`${mappings.length} mapped account(s) — the OAuth credential is left alone`)
        for (const m of mappings) {
          console.log(`  ${m.code.padEnd(6)} ${m.name.padEnd(34)} -> ${m.providerAccountId}`)
        }
      }

      const identities = await db
        .select({
          entityType: schema.EntityDefinition.entityType,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.RecordIdentity)
        .innerJoin(
          schema.EntityDefinition,
          eq(schema.EntityDefinition.id, schema.RecordIdentity.entityDefinitionId)
        )
        .where(
          and(
            eq(schema.RecordIdentity.organizationId, org.id),
            eq(schema.RecordIdentity.connectionId, connection.connectionId)
          )
        )
        .groupBy(schema.EntityDefinition.entityType)
      const [cells] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.FieldValue)
        .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
        .where(qboIdCellFilter(org.id, connection.connectionId))
      const [placeholders] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.FinancialSourceAccount)
        .where(qboPlaceholderFilter(org.id))
      qboIdCells = cells?.n ?? 0
      qboPlaceholders = placeholders?.n ?? 0

      console.log('\nQuickBooks ids held on kept records (the cell is authoritative, the')
      console.log('RecordIdentity row is its fallback, so both go):')
      for (const row of identities) {
        qboIdentityRows += row.n
        console.log(`  RecordIdentity ${(row.entityType ?? '?').padEnd(20)} ${row.n}`)
      }
      console.log(`  id cells (FieldValue)               ${qboIdCells}`)
      console.log(`  store placeholder customers         ${qboPlaceholders}`)
    }
  }

  // ── 7. The accounting configuration ───────────────────────────────────────

  heading('7. Accounting configuration (chart last)')

  const configIds = new Map<string, string[]>()
  let roleAssignments = 0
  let linkedFeeds = 0
  let pointerFieldIds: string[] = []
  let pointerRows = 0

  if (KEEP_CONFIG) {
    console.log('--keep-config: skipped.')
  } else {
    for (const [type, ids] of await readInstanceIds(org.id, CONFIG_TYPES)) {
      configIds.set(type, ids)
    }
    const [roles] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, org.id))
    roleAssignments = roles?.n ?? 0

    const [feeds] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.FinancialSourceAccount)
      .where(
        and(
          eq(schema.FinancialSourceAccount.organizationId, org.id),
          isNotNull(schema.FinancialSourceAccount.paymentGatewayId)
        )
      )
    linkedFeeds = feeds?.n ?? 0

    const pointerFields = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, org.id),
          inArray(schema.CustomField.systemAttribute, Object.keys(GL_ACCOUNT_POINTER_ATTRIBUTES))
        )
      )
    pointerFieldIds = pointerFields.map((f) => f.id)
    if (pointerFieldIds.length > 0) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, org.id),
            inArray(schema.FieldValue.fieldId, pointerFieldIds)
          )
        )
      pointerRows = row?.n ?? 0
    }

    console.log(`  GlRoleAssignment               ${String(roleAssignments).padStart(5)}`)
    console.log(
      `  FinancialSourceAccount links   ${String(linkedFeeds).padStart(5)}  (gateway -> null, row kept)`
    )
    for (const type of CONFIG_TYPES) {
      const n = configIds.get(type)?.length ?? 0
      console.log(`  ${type.padEnd(30)} ${String(n).padStart(5)}`)
    }
    console.log(
      `  gl_account pointers (TEXT)     ${String(pointerRows).padStart(5)}  (incl. on records above)`
    )
    if (KEEP_QUICKBOOKS && (configIds.get('gl_account')?.length ?? 0) > 0) {
      console.log(
        '  ⚠️ --keep-quickbooks: the account map lives on the chart rows and goes with them'
      )
    }
  }
  const configTotal = [...configIds.values()].reduce((a, ids) => a + ids.length, 0)

  // ── 8. Numbering and settings ─────────────────────────────────────────────

  heading('8. Record numbering and settings')

  const sequences = await db
    .select({
      scope: schema.RecordSequence.scope,
      prefix: schema.RecordSequence.prefix,
      currentNumber: schema.RecordSequence.currentNumber,
    })
    .from(schema.RecordSequence)
    .where(
      and(
        eq(schema.RecordSequence.organizationId, org.id),
        inArray(schema.RecordSequence.scope, [...CLEARED_SEQUENCE_SCOPES])
      )
    )
  console.log(`RecordSequence  ${sequences.length} counter(s) back to 0`)
  for (const s of sequences) {
    console.log(`  ${s.scope.padEnd(20)} ${s.prefix ?? ''}-${s.currentNumber} -> 0`)
  }
  console.log(`\nsettings        ${SETTING_RESETS.length} key(s) to their catalog defaults`)
  console.log('  accounting.setupState -> draft, the wizard reruns from page 1')
  console.log('  inventory.autoBuildFromOrders -> false, and its cutoff stamp cleared')

  if (!CONFIRM) {
    console.log('\ndry run — nothing was written. Re-run with --confirm.\n')
    return
  }

  // ── 9. Do it ──────────────────────────────────────────────────────────────

  heading('9. Writing')

  // Batches first: `ExportBatchPosting`'s FK to the posting is ON DELETE NO ACTION.
  await db
    .delete(schema.ExportBatchPosting)
    .where(eq(schema.ExportBatchPosting.organizationId, org.id))
  await db.delete(schema.ExportBatch).where(eq(schema.ExportBatch.organizationId, org.id))

  for (const p of postings) {
    await db
      .delete(schema.GlPosting)
      .where(and(eq(schema.GlPosting.id, p.id), eq(schema.GlPosting.organizationId, org.id)))
  }
  console.log(`deleted ${postings.length} GlPosting row(s) and their lines`)

  for (const { table } of SIDE_TABLES) {
    await db.delete(table).where(eq(table.organizationId, org.id))
  }
  console.log(`cleared ${SIDE_TABLES.length} side table(s)`)

  // One transaction: a half-cleared money model is the state this step exists to prevent.
  await db.transaction(async (tx) => {
    for (const { table } of MONEY_TABLES) {
      await tx.delete(table).where(eq(table.organizationId, org.id))
    }
  })
  console.log(`cleared ${MONEY_TABLES.length} money, evidence and mirror table(s)`)

  for (const chunk of chunked(allIds)) {
    await db
      .delete(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, org.id),
          inArray(schema.RecordRuleRun.entityInstanceId, chunk)
        )
      )
  }

  // Before the waves, so no instance delete has a SET NULL binding row to update.
  if (!KEEP_CONNECTOR_ITEMS) {
    for (const chunk of chunked(bindingIds)) {
      await db.delete(schema.DataConnectorItem).where(inArray(schema.DataConnectorItem.id, chunk))
    }
  }

  for (const [index, wave] of DELETE_WAVES.entries()) {
    let waveCount = 0
    for (const type of wave) {
      const ids = idsByType.get(type) ?? []
      if (ids.length === 0) continue
      waveCount += await deleteInstancesOrExit(org.id, ids, `wave ${index + 1} failed on ${type}`)
    }
    console.log(`wave ${index + 1}: deleted ${waveCount} record(s)`)
  }

  if (!KEEP_CONNECTOR_ITEMS) {
    const startedAtIso = new Date().toISOString()
    for (const stream of streams) {
      await db
        .update(schema.DataConnectorStream)
        .set({
          state: freshBackfillState(
            (stream.state ?? {}) as Parameters<typeof freshBackfillState>[0],
            startedAtIso
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.DataConnectorStream.id, stream.id))
    }

    await db
      .update(schema.DataConnector)
      .set({ itemCount: 0, lastSyncedAt: null, updatedAt: new Date() })
      .where(eq(schema.DataConnector.organizationId, org.id))

    console.log(
      `deleted ${bindingIds.length} connector binding(s); ${streams.length} stream(s) back to backfill`
    )
  }

  if (qohFieldId) {
    await db
      .update(schema.FieldValue)
      .set({ valueNumber: 0, updatedAt: new Date() })
      .where(
        and(eq(schema.FieldValue.organizationId, org.id), eq(schema.FieldValue.fieldId, qohFieldId))
      )
  }
  if (statusFieldId) {
    await db
      .update(schema.FieldValue)
      .set({ optionId: 'out_of_stock', updatedAt: new Date() })
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          eq(schema.FieldValue.fieldId, statusFieldId)
        )
      )
  }
  console.log('quantity on hand zeroed, stock status set to out_of_stock')

  // BEFORE the chart wipe: the map is a cell on the `gl_account` row mirrored into
  // `RecordIdentity`, and the cascade would otherwise make every call a no-op.
  if (connection) {
    for (const m of mappings) {
      await clearQuickbooksAccountMapping({
        organizationId: org.id,
        installationId: connection.installationId,
        connectionId: connection.connectionId,
        glAccountId: m.glAccountId,
      })
    }
    console.log(`cleared ${mappings.length} QuickBooks account mapping(s)`)

    // The next send re-creates customers, vendors and items instead of naming dead ids.
    const idFields = db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, org.id),
          eq(schema.CustomField.connectionId, connection.connectionId),
          eq(schema.CustomField.isIdentity, true)
        )
      )
    await db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          inArray(schema.FieldValue.fieldId, idFields)
        )
      )
    await db
      .delete(schema.RecordIdentity)
      .where(
        and(
          eq(schema.RecordIdentity.organizationId, org.id),
          eq(schema.RecordIdentity.connectionId, connection.connectionId)
        )
      )
    await db
      .update(schema.FinancialSourceAccount)
      .set({
        providerCustomerRef: sql`${schema.FinancialSourceAccount.providerCustomerRef} - ${QUICKBOOKS_APP_SLUG}::text`,
      })
      .where(qboPlaceholderFilter(org.id))
    console.log(
      `cleared ${qboIdCells} QuickBooks id cell(s), ${qboIdentityRows} RecordIdentity row(s), ` +
        `${qboPlaceholders} placeholder customer(s)`
    )
  }

  if (!KEEP_CONFIG) {
    await deleteConfiguration(org.id, configIds, pointerFieldIds)
    console.log(
      `deleted ${roleAssignments} role assignment(s), ${configTotal} configuration record(s) ` +
        `(${CONFIG_TYPES.map((t) => `${t} ${configIds.get(t)?.length ?? 0}`).join(', ')}); ` +
        `unlinked ${linkedFeeds} feed(s)`
    )
  }

  await db
    .update(schema.RecordSequence)
    .set({ currentNumber: 0, updatedAt: new Date() })
    .where(
      and(
        eq(schema.RecordSequence.organizationId, org.id),
        inArray(schema.RecordSequence.scope, [...CLEARED_SEQUENCE_SCOPES])
      )
    )
  console.log(`reset ${sequences.length} record counter(s) to 0`)

  await setLockedThrough(db, { organizationId: org.id, periodKey: null, actorUserId: 'system' })
  await batchUpdateOrganizationSettings({ organizationId: org.id, settings: SETTING_RESETS })
  // 🛑 The ROUTER's job when a human does this, not this function's.
  // `batchUpdateOrganizationSettings` does not bust the `orgSettings` cache, and
  // the key's TTL is a day — skipping the event leaves the wizard reading
  // `finalized` out of Redis long after the row says `draft`.
  await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
  console.log(`reset ${SETTING_RESETS.length} setting(s)`)

  // The records are gone; anything that cached a count or a list of them is now
  // describing a world that does not exist. `chartAccounts` has a one-day TTL, so
  // without this the wizard still sees the dropped chart and skips the pack picker.
  await getOrgCache().invalidateAndRecompute(org.id, [
    'resources',
    'customFields',
    'orgSettings',
    'chartAccounts',
    'providerChart',
  ])
  console.log('org cache invalidated')

  console.log(
    `\ndone.\n\n` +
      `  ${postings.length} ledger posting(s), ${instanceTotal} record(s), ` +
      `${moneyTotal} money/evidence row(s), ${bindingIds.length} connector binding(s)\n` +
      `  ${mappings.length} account mapping(s), ${sequences.length} counter(s), ` +
      `${SETTING_RESETS.length} setting(s)\n` +
      (KEEP_CONFIG
        ? '  configuration kept (--keep-config)\n\n'
        : `  ${configTotal} configuration record(s), ${roleAssignments} role assignment(s)\n\n`) +
      'Next:\n' +
      '  1. Run the accounting setup wizard again — it reruns from page 1 and the\n' +
      '     opening baseline is editable.' +
      (KEEP_CONFIG
        ? '\n'
        : ' The chart is empty: provision it from the pack\n' +
          '     picker (card_rail re-seeds the Shopify Payments gateway) or import it from\n' +
          '     QuickBooks, then add the other rails on the rails page once orders re-sync.\n') +
      '     The account map is empty, so the first Post refuses until the accounts are\n' +
      '     re-mapped. That refusal is the mapping step working.\n' +
      '  2. Sync the connectors. Every stream is back to backfill phase with no\n' +
      '     watermark, so history is re-crawled: kept records stay bound, orders\n' +
      '     re-mint from ORD-0001.' +
      (KEEP_CONFIG
        ? '\n'
        : ' Bank feeds re-create their bank accounts; link each\n' +
          '     to its GL account and re-link the store feeds to their rails.\n') +
      '  3. Turn inventory.autoBuildFromOrders back on if the retest needs it. It\n' +
      '     re-stamps its cutoff at that moment, so orders synced BEFORE you flip it\n' +
      '     will not auto-build.\n'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
