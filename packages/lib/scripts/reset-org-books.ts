// packages/lib/scripts/reset-org-books.ts
//
// 🛑 DEV-ONLY. Returns one organization's TRANSACTIONAL state to zero so the
// whole money + inventory flow can be driven again from scratch: the ledger,
// every accounting document, orders, builds, movements, purchasing, the sales
// pipeline, record numbering, connector bindings and the QuickBooks map.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-org-books.ts DemoOrg1
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-org-books.ts DemoOrg1 --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// ── What this KEEPS, and why that is the whole point ────────────────────────
//
// Parts, subparts, vendor parts, tariff codes and rates, the catalog, products,
// contacts, companies, tickets, inboxes, the chart of accounts and its
// `GlRoleAssignment` rows, bank accounts and bank rules. The reset is about
// the transactions, not the master data the transactions refer to.
//
// 🛑 That makes ONE fact load-bearing: `part` is matched on **SKU**
// (`identityRole: { kind: 'match', exclusive: true }`) and `contact` on email +
// phone, so wiping their `DataConnectorItem` bindings re-links them on the next
// sync rather than minting duplicates. `order`, `line_item`, `product` and
// `catalog_item` carry an `externalId` role only, so they re-mint — which is
// what is wanted, since they are being deleted here. Before trusting the part
// half of that, this script CHECKS it: a bound part with a blank or duplicated
// SKU cannot be re-matched and would come back as a second part, so it refuses.
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
// 2. **The Drizzle side tables before the instances they point at.**
//    `PaymentAllocation.invoiceInstanceId` and four `PaymentTransaction`
//    columns are ON DELETE RESTRICT against `EntityInstance`. They do not
//    cascade and they are not registry relationships, so nothing else clears
//    them and the invoice delete simply fails partway.
// 3. **Instances deepest-first.** Children before parents, so a sweep never
//    runs against a parent that is already gone.
// 4. **`DataConnectorItem` explicitly.** Its two instance pointers are ON
//    DELETE **SET NULL**, not cascade. Left alone, the binding survives the
//    record with a NULL instance and its `contentHash` still matches, so the
//    next sync counts the record `skipped` and re-creates nothing.
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

import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { freshBackfillState } from '../src/data-connectors/slice-orchestrator'
import { deleteEntityInstances } from '../src/entity-instances'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/money/quickbooks/account-map'
import { listChartAccounts } from '../src/postings'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)

const CONFIRM = args.includes('--confirm')
const FORCE = args.includes('--force')
const KEEP_CONNECTOR_ITEMS = args.includes('--keep-connector-items')
const KEEP_QUICKBOOKS = args.includes('--keep-quickbooks')

if (!ORG_ARG) {
  console.error(
    'usage: reset-org-books.ts <organizationId|name> [options]\n\n' +
      '  options:\n' +
      '    --keep-connector-items  leave DataConnectorItem + stream watermarks alone.\n' +
      '                            🛑 Deleted records then do NOT come back on the next\n' +
      '                            sync: the binding outlives the record with a NULL\n' +
      '                            instance and its contentHash still matches, so the\n' +
      '                            record is counted skipped and never re-created.\n' +
      '    --keep-quickbooks       do not clear the QuickBooks account map.\n' +
      '    --force                 past the providerEntryId and part-SKU guards.\n' +
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
  // Order children, and the credit-memo closure that hangs off them.
  ['line_item', 'tax_line', 'credit_memo_application', 'credit_memo_line', 'credit_memo'],
  // The inventory ledger, then what wrote it.
  ['stock_movement', 'build'],
  // Purchasing: lines before documents, allocations before payments.
  [
    'purchase_order_line',
    'vendor_bill_line',
    'vendor_payment_allocation',
    'purchase_order',
    'vendor_bill',
    'vendor_payment',
  ],
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
  { name: 'PaymentAllocation', table: schema.PaymentAllocation },
  { name: 'PaymentTransaction', table: schema.PaymentTransaction },
  { name: 'InvoiceLineAllocation', table: schema.InvoiceLineAllocation },
  { name: 'InvoiceScheduleAllocation', table: schema.InvoiceScheduleAllocation },
  { name: 'InvoiceVisitAllocation', table: schema.InvoiceVisitAllocation },
  { name: 'WorkOrderBillingInstallment', table: schema.WorkOrderBillingInstallment },
  { name: 'WorkOrderVisit', table: schema.WorkOrderVisit },
] as const

/**
 * Every key the accounting wizard, the close and the auto-build switch write,
 * returned to its catalog default.
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
 */
const SETTING_RESETS = [
  { key: 'accounting.setupState' as const, value: 'draft' },
  { key: 'accounting.setupFinalizedAt' as const, value: null },
  { key: 'accounting.setupFinalizedByUserId' as const, value: null },
  { key: 'accounting.cutoffPeriod' as const, value: null },
  { key: 'accounting.bookTimeZone' as const, value: null },
  { key: 'accounting.openingRawMaterials' as const, value: null },
  { key: 'accounting.openingWip' as const, value: null },
  { key: 'accounting.openingFinishedGoods' as const, value: null },
  { key: 'accounting.qboOpeningRawMaterials' as const, value: null },
  { key: 'accounting.qboOpeningWip' as const, value: null },
  { key: 'accounting.qboOpeningFinishedGoods' as const, value: null },
  { key: 'accounting.qboOpeningJournalRef' as const, value: null },
  { key: 'ledger.lockedThroughMonth' as const, value: null },
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

/** Instance ids per entity type, for the types this script clears. */
async function readInstanceIds(organizationId: string): Promise<Map<string, string[]>> {
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
        inArray(schema.EntityDefinition.entityType, [...CLEARED_TYPES])
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
 * Refuse when a connector-bound part could not be re-matched after its binding
 * is dropped.
 *
 * The part mapping's match key is SKU. A bound part with a blank SKU has
 * nothing to match on and a duplicated SKU is refused by the `exclusive` rule,
 * so either one comes back as a SECOND part on the next sync — the one outcome
 * "do not delete parts" is supposed to rule out. Checked rather than assumed,
 * because it is a property of the data and not of the code.
 */
async function assertPartsCanRematch(organizationId: string): Promise<number> {
  const skuField = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'part_sku')
      )
    )
    .limit(1)

  const fieldId = skuField[0]?.id
  if (!fieldId) {
    console.log('parts: no part_sku field in this org — nothing bound to check\n')
    return 0
  }

  const bound = await db
    .select({
      instanceId: schema.DataConnectorItem.entityInstanceId,
      sku: schema.FieldValue.valueText,
    })
    .from(schema.DataConnectorItem)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.DataConnectorItem.entityDefinitionId)
    )
    .leftJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.DataConnectorItem.entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'part'),
        isNotNull(schema.DataConnectorItem.entityInstanceId)
      )
    )

  const blank = bound.filter((row) => !row.sku || row.sku.trim() === '')
  const seen = new Map<string, number>()
  for (const row of bound) {
    const sku = row.sku?.trim()
    if (sku) seen.set(sku, (seen.get(sku) ?? 0) + 1)
  }
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1)

  console.log(
    `parts: ${bound.length} connector-bound, ${blank.length} with a blank SKU, ` +
      `${duplicated.length} duplicated SKU(s)`
  )

  if ((blank.length > 0 || duplicated.length > 0) && !FORCE) {
    console.error(
      '\n🛑 REFUSING to drop the connector bindings. The part mapping matches on SKU, so a\n' +
        '   part with a blank or duplicated SKU cannot be re-matched and comes back as a\n' +
        '   SECOND part on the next sync.\n\n' +
        (duplicated.length > 0
          ? `   duplicated: ${duplicated
              .slice(0, 10)
              .map(([sku, n]) => `${sku} (x${n})`)
              .join(', ')}\n`
          : '') +
        '\n   Fix the SKUs, pass --keep-connector-items, or pass --force.\n'
    )
    process.exit(1)
  }
  console.log('')
  return bound.length
}

async function main() {
  const org = await resolveOrg()

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to write)'}`)
  console.log(
    `scope        ledger + documents + orders + builds + movements + purchasing +\n` +
      `             pipeline + numbering${KEEP_CONNECTOR_ITEMS ? '' : ' + connector bindings'}` +
      `${KEEP_QUICKBOOKS ? '' : ' + QuickBooks map'}`
  )
  console.log('keeps        parts, contacts, companies, tickets, the chart of accounts,')
  console.log('             bank accounts and bank rules\n')

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
      providerId: schema.GlPosting.providerId,
      providerEntryId: schema.GlPosting.providerEntryId,
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

  const exportedRows = postings.filter((p) => p.providerEntryId !== null)
  if (exportedRows.length > 0 && !FORCE) {
    console.error(
      `\n🛑 REFUSING. ${exportedRows.length} posting(s) carry a providerEntryId and are already in\n` +
        '   the accounting system. Deleting our row orphans a real journal entry over there and\n' +
        '   leaves the next close computing its delta against a snapshot the provider no longer\n' +
        '   agrees with.\n\n' +
        '   Reverse them in the app, or pass --force once you have deleted them by hand.\n'
    )
    for (const p of exportedRows.slice(0, 10)) {
      console.error(
        `   ${p.docNumber} ${money(p.totalMinor)} -> ${p.providerId}:${p.providerEntryId}`
      )
    }
    process.exit(1)
  }
  if (exportedRows.length > 0) {
    console.log(
      `\n⚠️  --force: deleting ${exportedRows.length} posting(s) that DID reach the provider.`
    )
  }

  // ── 2. The Drizzle side tables ────────────────────────────────────────────

  heading('2. Drizzle side tables (RESTRICT foreign keys go first)')

  const sideCounts: { name: string; n: number }[] = []
  for (const { name, table } of SIDE_TABLES) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.organizationId, org.id))
    sideCounts.push({ name, n: row?.n ?? 0 })
  }
  for (const { name, n } of sideCounts) {
    console.log(`  ${name.padEnd(30)} ${String(n).padStart(5)}`)
  }

  // ── 3. The instances ──────────────────────────────────────────────────────

  heading('3. Records, deepest wave first')

  const idsByType = await readInstanceIds(org.id)
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
  const [ruleRuns] = allIds.length
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.RecordRuleRun)
        .where(
          and(
            eq(schema.RecordRuleRun.organizationId, org.id),
            inArray(schema.RecordRuleRun.entityInstanceId, allIds)
          )
        )
    : [{ n: 0 }]
  console.log(`  RecordRuleRun ${ruleRuns?.n ?? 0} (no foreign key — cleared explicitly)`)

  // ── 4. Connector bindings ─────────────────────────────────────────────────

  heading('4. Connector bindings and stream watermarks')

  let boundParts = 0
  let connectorItems = 0
  const streams: { id: string; streamKey: string | null; state: unknown }[] = []

  if (KEEP_CONNECTOR_ITEMS) {
    console.log('--keep-connector-items: skipped.')
    console.log('🛑 Deleted records will NOT come back on the next sync — the binding outlives')
    console.log('   the record and its contentHash still matches, so it is counted skipped.\n')
  } else {
    boundParts = await assertPartsCanRematch(org.id)

    const [items] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.organizationId, org.id))
    connectorItems = items?.n ?? 0

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

    console.log(`DataConnectorItem  ${connectorItems} binding(s) across every connector`)
    console.log(`  of which parts   ${boundParts} (re-match on SKU, no duplicates)`)
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
    }
  }

  // ── 7. Numbering and settings ─────────────────────────────────────────────

  heading('7. Record numbering and settings')

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

  // ── 8. Do it ──────────────────────────────────────────────────────────────

  heading('8. Writing')

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

  if (allIds.length > 0) {
    await db
      .delete(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, org.id),
          inArray(schema.RecordRuleRun.entityInstanceId, allIds)
        )
      )
  }

  for (const [index, wave] of DELETE_WAVES.entries()) {
    let waveCount = 0
    for (const type of wave) {
      const ids = idsByType.get(type) ?? []
      if (ids.length === 0) continue
      const result = await deleteEntityInstances({ ids, organizationId: org.id })
      if (result.isErr()) {
        console.error(`\n🛑 wave ${index + 1} failed on ${type}: ${result.error.message}`)
        process.exit(1)
      }
      waveCount += result.value.count
    }
    console.log(`wave ${index + 1}: deleted ${waveCount} record(s)`)
  }

  if (!KEEP_CONNECTOR_ITEMS) {
    await db
      .delete(schema.DataConnectorItem)
      .where(eq(schema.DataConnectorItem.organizationId, org.id))

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
      `deleted ${connectorItems} connector binding(s); ${streams.length} stream(s) back to backfill`
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

  await batchUpdateOrganizationSettings({ organizationId: org.id, settings: SETTING_RESETS })
  // 🛑 The ROUTER's job when a human does this, not this function's.
  // `batchUpdateOrganizationSettings` does not bust the `orgSettings` cache, and
  // the key's TTL is a day — skipping the event leaves the wizard reading
  // `finalized` out of Redis long after the row says `draft`.
  await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
  console.log(`reset ${SETTING_RESETS.length} setting(s)`)

  // The records are gone; anything that cached a count or a list of them is now
  // describing a world that does not exist.
  await getOrgCache().invalidateAndRecompute(org.id, ['resources', 'customFields', 'orgSettings'])
  console.log('org cache invalidated')

  console.log(
    `\ndone.\n\n` +
      `  ${postings.length} ledger posting(s), ${instanceTotal} record(s), ` +
      `${connectorItems} connector binding(s)\n` +
      `  ${mappings.length} account mapping(s), ${sequences.length} counter(s), ` +
      `${SETTING_RESETS.length} setting(s)\n\n` +
      'Next:\n' +
      '  1. Run the accounting setup wizard again — it reruns from page 1 and the\n' +
      '     opening baseline is editable. The account map is empty, so the first Post\n' +
      '     refuses until the accounts are re-mapped. That refusal is the mapping step\n' +
      '     working.\n' +
      '  2. Sync the connectors. Every stream is back to backfill phase with no\n' +
      '     watermark, so history is re-crawled: parts and contacts re-match, orders\n' +
      '     re-mint from ORD-0001.\n' +
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
