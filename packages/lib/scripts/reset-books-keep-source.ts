// packages/lib/scripts/reset-books-keep-source.ts
//
// 🛑 DEV-ONLY. Returns one organization's DERIVED accounting and inventory
// state to zero while leaving every connector-sourced record exactly where it
// is, so the whole pipeline can be re-driven against a fresh QuickBooks
// sandbox WITHOUT re-syncing Shopify.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-books-keep-source.ts DemoOrg1
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-books-keep-source.ts DemoOrg1 --sandbox-reset --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// ── Why this is neither of the other two reset scripts ──────────────────────
//
// `reset-accounting.ts` clears `GlPosting`, the QuickBooks map and the wizard
// settings. Everything the ledger was computed FROM survives it, INCLUDING the
// stock movements and the stamps on the documents, so a re-drive is a second
// pass over the same data with only the evidence removed.
//
// `reset-org-books.ts` is the whole closure - and its `DELETE_WAVES` take
// `order`, `line_item`, `credit_memo` and their `DataConnectorItem` bindings
// with them, which forces exactly the 100k-line Shopify re-sync this workflow
// exists to avoid.
//
// This one splits the difference on a line neither of them draws: **delete what
// the ledger PRODUCED, keep what produced it, and clear the stamps in between
// so the sources look unposted again.**
//
// ── The line is drawn by DataConnectorItem, not by entity type ──────────────
//
// Measured on DemoOrg1 (2026-09-14). Bound to the connector, therefore KEPT:
// order 6,500 · line_item 10,642 · tax_line 7,854 · fulfillment 7,468 ·
// fulfillment_line 10,401 · shipment 319 · parcel 527 · credit_memo 312 ·
// credit_memo_line 305 · contact · part · product · catalog_item ·
// bank_account. Not bound, therefore DELETABLE: stock_movement · build ·
// journal_entry · GlPosting.
//
// 🛑 `credit_memo` is the one that makes "delete by type" wrong: 312 of its 349
// rows are Shopify refunds. `reset-org-books.ts` deletes the type and takes all
// 312 with it. Here a credit memo is a SOURCE document - the record stays and
// only `credit_memo_gl_posting` is cleared, which is all it takes, because
// `credit-memo-posting/reads.ts:404` treats a null stamp as unposted and
// `runCreditMemoPosting` re-posts it. Posting never touched
// `credit_memo_status`, so there is no lifecycle to repair either.
//
// ── Nothing here deletes a DataConnectorItem, deliberately ──────────────────
//
// That table is never written by this script. It is the difference between a
// re-drive and a re-sync, and it is why the surviving records stay bound to
// their Shopify ids and do not re-mint.
//
// ── What has NO door back, and is therefore the reason this script exists ───
//
// 🛑 `relieveFulfillmentLines` had two callers before this work and BOTH fire
// on arrival - a new dispatch in the app, or a sync manifest. A fulfillment
// already on disk with an unchanged `contentHash` is counted `skipped` by the
// connector and never reaches either. So deleting the `sale` movements without
// `relief/backfill.ts` leaves the shelf permanently wrong with no way back.
// Run `scripts/backfill-relief.ts` after this, and after the builds backfill.
//
// ── Two fields that look like posting state and are NOT ─────────────────────
//
// 1. `fulfillment_shipping_recognised` is LEFT ALONE. Freight is recognised in
//    full on one shipment per order, and that flag is written at CREATION
//    (`fulfillments/writes.ts:57`), not by the poster.
//    `fulfillment-posting/reads.ts:402` reads it straight back as
//    `includeShipping`. Clearing it would mean no shipment carries the freight
//    on the re-drive and the order's shipping revenue silently vanishes.
//    `shippingStillOwed` already reads the flag AND `glPosting`, so clearing
//    the stamp alone is what re-opens it.
// 2. `fulfillment_subtotal` / `fulfillment_total` are left alone too. The
//    planner recomputes and re-stamps them on every run, so they are stale for
//    exactly as long as it takes to press Post.
//
// ── Order is forced, in both directions ─────────────────────────────────────
//
// Deleting: `GlPosting` descending `revision` (`reversesId` is ON DELETE
// RESTRICT), then the stamps, then the instances, then the roll-ups they fed.
//
// 🛑 Re-driving: **builds BEFORE relief.** Relief prices at the part's ledger
// average and falls back to `part_standard_cost` only when on-hand is <= 0
// (`relief/relieve.ts` §3.6). With no `build_produce` movements in the ledger
// yet, every sale line prices off the fallback or is skipped as
// `skippedNoCost` - neither of which is an error and neither of which is loud.
//
// ── The roll-up and its movements are ONE operation ─────────────────────────
//
// 🛑 `fulfillment_line_quantity_relieved` is `computed: true` and re-SUMmed
// from the line's `sale` movements by a post-hook registered on the
// `mfg-stock-movements-deleted` rule. `deleteEntityInstances` emits NO
// lifecycle events - it is a raw set delete - so that hook never fires here and
// the roll-up would keep its old value. Relief's delta is
// `quantity - (quantityRelieved ?? 0)`, so a stale roll-up makes the line
// un-relievable FOREVER: the backfill reports success having written nothing.
// The roll-up rows are therefore deleted in the same phase as the movements,
// by the same argument `reset-org-books.ts` makes for zeroing QoH by hand -
// every movement is going, so the re-SUM is known without running it.

import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { deleteEntityInstances } from '../src/entity-instances'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/money/quickbooks/account-map'
import { listChartAccounts } from '../src/postings'
import { findGlAccountPointers } from '../src/postings/gl-account-pointers'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)

const CONFIRM = args.includes('--confirm')
const SANDBOX_RESET = args.includes('--sandbox-reset')
const KEEP_CHART = args.includes('--keep-chart')
const KEEP_QUICKBOOKS = args.includes('--keep-quickbooks')

if (!ORG_ARG) {
  console.error(
    'usage: reset-books-keep-source.ts <organizationId|name> [options]\n\n' +
      '  options:\n' +
      '    --sandbox-reset   the accounting provider was wiped too, so delete postings\n' +
      '                      that carry a providerEntryId without the orphan refusal.\n' +
      '                      🛑 Only true if you actually reset the sandbox - otherwise\n' +
      '                      those journal entries stay over there with nothing here\n' +
      '                      pointing at them.\n' +
      '    --keep-chart      leave gl_account + GlRoleAssignment standing, and leave the\n' +
      '                      chart pointers on payment_gateway / bank_account / bank_rule\n' +
      '                      alone. The wizard then skips Provision chart.\n' +
      '    --keep-quickbooks do not clear the QuickBooks account map.\n' +
      '    --confirm         actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

/**
 * Entity types this script DELETES: pure ledger output, none of it bound to a
 * connector, all of it re-drivable from the records that survive.
 *
 * Deepest-first. `stock_movement`'s self-relations (parent/child,
 * reverses/reversed-by) are `FieldValue` rows rather than foreign keys and the
 * sweep clears both ends, so the whole type goes in one wave.
 *
 * `journal_entry` is handled separately below - it is the one type here with
 * rows worth keeping.
 */
const DELETE_WAVES: readonly (readonly string[])[] = [['stock_movement'], ['build']]

/**
 * Every registry field holding a `GlPosting` id, plus the doc number written
 * beside one.
 *
 * 🛑 There is no `GL_POSTING_POINTER_ATTRIBUTES` in lib to import - unlike
 * `GL_ACCOUNT_POINTER_ATTRIBUTES`, which has one and a coverage test. These six
 * are spelled under TWO conventions (`*_gl_posting_id` and `*_gl_posting`), so
 * a grep for either alone finds four of them. If a seventh source gains a
 * stamp, nothing fails - it silently keeps a dangling id through this reset.
 */
const POSTING_STAMP_ATTRIBUTES = [
  'journal_entry_gl_posting_id',
  'payout_gl_posting_id',
  'bank_deposit_gl_posting_id',
  'bank_transaction_gl_posting_id',
  'credit_memo_gl_posting',
  'fulfillment_gl_posting',
  // Not a pointer, but it names the document the pointer named.
  'fulfillment_doc_number',
] as const

/**
 * Derived roll-ups whose `FieldValue` rows are DELETED, so the field reads as
 * "never computed" rather than as a stale number.
 *
 * `fulfillment_line_quantity_relieved` is the load-bearing one - see the
 * header. Null and 0 are different facts to relief's own docblock, but its
 * delta arithmetic treats them the same, and null is the honest one here.
 */
const DELETED_ROLLUP_ATTRIBUTES = ['fulfillment_line_quantity_relieved'] as const

/**
 * Per-record markers that outlive what they attest to, cleared by deleting the
 * row.
 *
 * Same test the settings list uses: a key belongs here when deleting the
 * postings or the movements makes its value a lie.
 *
 * 🛑 `bank_account_has_posted` is NOT in this list - it is `nullable: false`
 * with a `false` default and it is the ONLY term in the account removal gate
 * (false deletes, true archives). It is set to `false` explicitly below rather
 * than deleted, so the gate reads a value rather than an absence.
 */
const DELETED_MARKER_ATTRIBUTES = [
  'bank_account_coverage_from',
  'bank_account_coverage_gaps',
  'bank_rule_applied_count',
  'bank_rule_last_applied_at',
  'payment_gateway_last_settlement_at',
  'payment_gateway_last_fee_booked_at',
] as const

/**
 * TEXT pointers at a `gl_account` instance, cleared only when the chart is
 * being wiped.
 *
 * 🛑 This is what makes the chart wipe legal. `reset-gl-chart.ts` refuses to
 * wipe a chart anything points at, via `findGlAccountPointers` - the guard
 * added after 2026-09-11, when a wipe left `payment_gateway.clearingAccount`
 * naming an id that existed nowhere and the next fulfillment post refused.
 * Clearing the pointers SATISFIES that guard rather than bypassing it, and the
 * script re-asks `findGlAccountPointers` afterwards to prove it.
 *
 * `payment_gateway_clearing_account` is REQUIRED. Clearing it leaves the
 * gateway failing its own validation until the wizard re-maps it, which is a
 * legible refusal on a settings screen; a dangling id is an illegible one deep
 * inside a posting.
 *
 * `stock_movement_gl_account` is deliberately absent even though
 * `GL_ACCOUNT_POINTER_ATTRIBUTES` lists it: it holds a ROLE string
 * (`inventory_finished_goods`), never an account id - its own registry docblock
 * says so - and every movement is being deleted anyway.
 */
const CHART_POINTER_ATTRIBUTES = [
  'payment_gateway_clearing_account',
  'payment_gateway_fee_account',
  'bank_account_gl_account',
  'bank_rule_gl_account',
  'bank_transaction_gl_account',
  'bank_transaction_suggested_gl_account',
  'vendor_bill_line_gl_account',
] as const

/**
 * `RecordSequence.scope` values put back to 0 UNCONDITIONALLY - every record
 * that ever drew a number from them is deleted by this script.
 *
 * 🛑 Deliberately NOT `order`, `fulfillment`, `credit_memo` or any other
 * surviving type. Their records still exist and still carry their numbers;
 * resetting those counters would re-mint ORD-0001 over a live ORD-0001.
 *
 * 🛑 `journal_entry` is not here either, and the reason is the same rule read
 * one level finer: this script KEEPS recurring templates, and they hold
 * numbers. On DemoOrg1 the counter reads 7 with templates standing at
 * JNL-0003..JNL-0007, so zeroing it re-mints JNL-0003 straight onto a live
 * record. It is reset only when nothing survives - see {@link main}.
 *
 * `build_batch` is not an entity type - it is an internal scope numbering batch
 * build RUNS, and the runs it numbered live on the `build` rows this deletes.
 * Leaving it alone means an org with zero builds opens its next batch run
 * reading "run 14".
 */
const CLEARED_SEQUENCE_SCOPES = ['build', 'build_batch'] as const

/** Reset to 0 only when this script leaves the type with no records at all. */
const CONDITIONAL_SEQUENCE_SCOPE = 'journal_entry'

/**
 * Every setting the wizard, the close, the inbound sync and the auto-build
 * switch write, returned to its catalog default.
 *
 * Written through `batchUpdateOrganizationSettings` rather than deleted, so the
 * organization lands exactly where one that never opened the wizard sits and
 * still passes that function's normalization and unknown-key check.
 *
 * Copied from `reset-org-books.ts` rather than imported: these lists are the
 * argument each script makes about its own blast radius, and a shared constant
 * would let a key that belongs to one reset silently join the other.
 *
 * ⚠️ `openingSource` resets to `'manual'`, not null - it is a SINGLE_SELECT
 * whose catalog default is a real option, and null is not one of its values.
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
  { key: 'accounting.openingSource' as const, value: 'manual' },
  { key: 'accounting.openingSourceAsOf' as const, value: null },
  { key: 'accounting.qboOpeningRawMaterials' as const, value: null },
  { key: 'accounting.qboOpeningWip' as const, value: null },
  { key: 'accounting.qboOpeningFinishedGoods' as const, value: null },
  { key: 'accounting.qboOpeningJournalRef' as const, value: null },
  { key: 'accounting.providerSyncedThrough' as const, value: null },
  { key: 'ledger.lockedThroughMonth' as const, value: null },
  { key: 'inventory.autoBuildFromOrders' as const, value: false },
  { key: 'inventory.autoBuildEnabledAt' as const, value: null },
  { key: 'inventory.autoBuildStockRule' as const, value: 'out_of_stock_only' },
]

const QUICKBOOKS_APP_SLUG = 'quickbooks'
/** The one `journal_entry_kind` worth keeping: user configuration, not output. */
const RECURRING_TEMPLATE_KIND = 'recurring_template'

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
 * map" is the wrong failure mode.
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

/** `CustomField.id` for each of `attributes` that this org actually has. */
async function resolveFieldIds(
  organizationId: string,
  attributes: readonly string[]
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, [...attributes])
      )
    )
  const byAttribute = new Map<string, string>()
  for (const row of rows) if (row.attribute) byAttribute.set(row.attribute, row.id)
  return byAttribute
}

/** How many `FieldValue` rows exist for each field id, for the dry run. */
async function countFieldValues(
  organizationId: string,
  fieldIds: readonly string[]
): Promise<number> {
  if (fieldIds.length === 0) return 0
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )
  return row?.n ?? 0
}

/** Instance ids per entity type, for the types this script deletes. */
async function readInstanceIds(
  organizationId: string,
  types: readonly string[]
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ id: schema.EntityInstance.id, entityType: schema.EntityDefinition.entityType })
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
 * `journal_entry` instances that are NOT recurring templates.
 *
 * A template is configuration a person wrote and would have to write again; a
 * posted manual entry and the wizard's own `opening_balance` entry are output.
 * The kind lives in `FieldValue.optionId` (it is a SINGLE_SELECT).
 */
async function readDeletableJournalEntryIds(organizationId: string): Promise<string[]> {
  const byType = await readInstanceIds(organizationId, ['journal_entry'])
  const all = byType.get('journal_entry') ?? []
  if (all.length === 0) return []

  const templates = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'journal_entry_kind'),
        eq(schema.FieldValue.optionId, RECURRING_TEMPLATE_KIND)
      )
    )

  const keep = new Set(templates.map((row) => row.entityId))
  return all.filter((id) => !keep.has(id))
}

async function main() {
  const org = await resolveOrg()

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`mode         ${CONFIRM ? 'WRITE' : 'dry run (pass --confirm to write)'}`)
  console.log(
    `chart        ${KEEP_CHART ? 'kept' : 'wiped, wizard re-provisions'}` +
      `   quickbooks map ${KEEP_QUICKBOOKS ? 'kept' : 'cleared'}` +
      `   provider ${SANDBOX_RESET ? 'assumed wiped' : 'assumed live'}`
  )

  // ── 1. The ledger ─────────────────────────────────────────────────────────

  heading('1. GlPosting')

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
    // Descending revision is the delete order `reversesId`'s RESTRICT forces:
    // a reversal always claims a revision above the row it reverses.
    .orderBy(desc(schema.GlPosting.revision))

  const byPostingType = new Map<string, number>()
  for (const p of postings) {
    byPostingType.set(p.postingType, (byPostingType.get(p.postingType) ?? 0) + 1)
  }
  const exported = postings.filter((p) => p.providerEntryId !== null)

  if (postings.length === 0) {
    console.log('none - already clean')
  } else {
    for (const [type, count] of [...byPostingType].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${type}`)
    }
    const total = postings.reduce((sum, p) => sum + Number(p.totalMinor), 0)
    console.log(`  ${String(postings.length).padStart(6)}  TOTAL, ${money(total)} posted`)
    console.log(`  ${exported.length} of them reached the provider`)
  }

  if (exported.length > 0 && !SANDBOX_RESET) {
    console.error(
      `\n🛑 REFUSING. ${exported.length} posting(s) carry a providerEntryId and are already in\n` +
        '   the accounting system. Deleting our row orphans a real journal entry over there.\n\n' +
        '   If you reset the QuickBooks sandbox, say so with --sandbox-reset - that is what\n' +
        '   this flag is for, and it is the only thing that makes deleting them correct.\n'
    )
    process.exit(1)
  }

  // ── 2. The stamps on the surviving sources ────────────────────────────────

  heading('2. Posting stamps on records that SURVIVE')

  const stampFields = await resolveFieldIds(org.id, POSTING_STAMP_ATTRIBUTES)
  let stampRows = 0
  for (const attribute of POSTING_STAMP_ATTRIBUTES) {
    const fieldId = stampFields.get(attribute)
    if (!fieldId) continue
    const n = await countFieldValues(org.id, [fieldId])
    stampRows += n
    if (n > 0) console.log(`  ${String(n).padStart(6)}  ${attribute}`)
  }
  console.log(
    stampRows === 0
      ? '  none'
      : `  ${stampRows} row(s) -> deleted, so each source reads unposted again`
  )

  // ── 3. Derived records ────────────────────────────────────────────────────

  heading('3. Records deleted (ledger output, none connector-bound)')

  const idsByType = await readInstanceIds(org.id, DELETE_WAVES.flat())
  const journalEntryIds = await readDeletableJournalEntryIds(org.id)
  let instanceTotal = journalEntryIds.length
  for (const wave of DELETE_WAVES) {
    for (const type of wave) {
      const n = (idsByType.get(type) ?? []).length
      instanceTotal += n
      if (n > 0) console.log(`  ${String(n).padStart(6)}  ${type}`)
    }
  }
  if (journalEntryIds.length > 0) {
    console.log(`  ${String(journalEntryIds.length).padStart(6)}  journal_entry (non-template)`)
  }
  const templatesKept =
    ((await readInstanceIds(org.id, ['journal_entry'])).get('journal_entry') ?? []).length -
    journalEntryIds.length
  if (templatesKept > 0) {
    console.log(`  ${String(templatesKept).padStart(6)}  journal_entry recurring templates - KEPT`)
  }
  if (instanceTotal === 0) console.log('  none')

  // A binding whose record is gone survives with a NULL instance and a matching
  // contentHash, so the next sync counts the record `skipped`. None of the types
  // above are bound - this proves it rather than assuming it.
  const [boundRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, org.id),
        isNotNull(schema.DataConnectorItem.entityInstanceId),
        inArray(schema.DataConnectorItem.entityInstanceId, [
          ...(idsByType.get('stock_movement') ?? []),
          ...(idsByType.get('build') ?? []),
          ...journalEntryIds,
        ])
      )
    )
  const boundDeletable = boundRow?.n ?? 0
  if (boundDeletable > 0) {
    console.error(
      `\n🛑 REFUSING. ${boundDeletable} of the records above ARE bound to a connector.\n` +
        '   Deleting one leaves its binding with a NULL instance and a matching contentHash,\n' +
        '   so the next sync counts it skipped and never re-creates it. That is a re-sync,\n' +
        '   which is the one thing this script exists to avoid.\n'
    )
    process.exit(1)
  }

  const [connectorItems] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.organizationId, org.id))
  console.log(`\n  ${connectorItems?.n ?? 0} connector binding(s) UNTOUCHED - no re-sync needed`)

  // ── 4. Roll-ups and markers ───────────────────────────────────────────────

  heading('4. Derived roll-ups and markers')

  const rollupFields = await resolveFieldIds(org.id, DELETED_ROLLUP_ATTRIBUTES)
  const markerFields = await resolveFieldIds(org.id, DELETED_MARKER_ATTRIBUTES)
  for (const attribute of [...DELETED_ROLLUP_ATTRIBUTES, ...DELETED_MARKER_ATTRIBUTES]) {
    const fieldId = rollupFields.get(attribute) ?? markerFields.get(attribute)
    if (!fieldId) continue
    const n = await countFieldValues(org.id, [fieldId])
    if (n > 0) console.log(`  ${String(n).padStart(6)}  ${attribute} -> deleted`)
  }

  const partFields = await resolveFieldIds(org.id, [
    'part_quantity_on_hand',
    'part_stock_status',
    'bank_account_has_posted',
  ])
  const qohFieldId = partFields.get('part_quantity_on_hand')
  const statusFieldId = partFields.get('part_stock_status')
  const hasPostedFieldId = partFields.get('bank_account_has_posted')

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
  console.log(`  ${String(qohRows).padStart(6)}  part(s) with non-zero QoH -> 0, out_of_stock`)
  console.log('          (every movement is going, so the re-SUM is known without running it)')

  let hasPostedRows = 0
  if (hasPostedFieldId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          eq(schema.FieldValue.fieldId, hasPostedFieldId),
          eq(schema.FieldValue.valueBoolean, true)
        )
      )
    hasPostedRows = row?.n ?? 0
  }
  console.log(
    `  ${String(hasPostedRows).padStart(6)}  bank account(s) stamped has_posted -> false\n` +
      '          (write-once in the product, and the only term in the removal gate)'
  )

  // ── 5. The chart ──────────────────────────────────────────────────────────

  heading('5. Chart of accounts')

  const chartIds = (await readInstanceIds(org.id, ['gl_account'])).get('gl_account') ?? []
  const [roleRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, org.id))
  const roleAssignments = roleRow?.n ?? 0

  const pointerFields = await resolveFieldIds(org.id, CHART_POINTER_ATTRIBUTES)
  let pointerRows = 0
  for (const attribute of CHART_POINTER_ATTRIBUTES) {
    const fieldId = pointerFields.get(attribute)
    if (!fieldId) continue
    const n = await countFieldValues(org.id, [fieldId])
    pointerRows += n
    if (n > 0) console.log(`  ${String(n).padStart(6)}  ${attribute}`)
  }

  if (KEEP_CHART) {
    console.log(`  --keep-chart: ${chartIds.length} account(s) and their pointers left alone`)
  } else {
    console.log(
      `  ${String(chartIds.length).padStart(6)}  gl_account -> deleted\n` +
        `  ${String(roleAssignments).padStart(6)}  GlRoleAssignment -> deleted\n` +
        `  ${String(pointerRows).padStart(6)}  chart pointer(s) -> cleared FIRST, which is what\n` +
        "          satisfies reset-gl-chart's findGlAccountPointers guard"
    )
  }

  // ── 6. The QuickBooks account map ─────────────────────────────────────────

  heading('6. QuickBooks account map')

  let mappings: { glAccountId: string; code: string; name: string; providerAccountId: string }[] =
    []
  let connection: { installationId: string; connectionId: string } | null = null

  if (KEEP_QUICKBOOKS) {
    console.log('  --keep-quickbooks: skipped')
  } else {
    connection = await resolveQuickbooksConnection(org.id)
    if (!connection) {
      console.log('  no QuickBooks connection for this org - nothing to clear')
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
      console.log(
        mappings.length === 0 ? '  empty' : `  ${mappings.length} mapped account(s) -> cleared`
      )

      // An EMPTY map beside a populated chart means some OTHER connection owns
      // the identities on these accounts.
      //
      // Swapping sandboxes on its own does NOT cause this. `qboAccountId` is
      // `scope: 'connection'`, and disconnecting is a HARD delete, so
      // `CustomField.connectionId` (ON DELETE CASCADE) takes the column, every
      // `FieldValue` under it, and every `RecordIdentity` on that connection,
      // with the credential. Disconnect the old realm and connect a new one and
      // the map is genuinely empty, which is what this will say.
      //
      // 🛑 The case this catches is TWO live QuickBooks credentials at once -
      // the new sandbox connected without disconnecting the old. This script's
      // `resolveQuickbooksConnection` takes `.limit(1)` with no ordering, so it
      // picks one ARBITRARILY and the other's map is invisible to it. Those
      // identities then cascade away with the chart wipe unexamined, which is
      // the one thing `reset-gl-chart.ts` refuses to do.
      if (mappings.length === 0 && chartIds.length > 0) {
        const [stale] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.RecordIdentity)
          .where(inArray(schema.RecordIdentity.entityInstanceId, chartIds))
        const staleIdentities = stale?.n ?? 0
        if (staleIdentities > 0) {
          console.log(
            `\n  ⚠️  ${staleIdentities} RecordIdentity row(s) on the chart that THIS connection\n` +
              '      cannot see, so another live credential owns them - most likely a second\n' +
              '      QuickBooks connected without disconnecting the first.\n' +
              '      They will cascade away with the chart rather than be cleared through the\n' +
              '      connection that owns them. Disconnect the one you are abandoning first\n' +
              '      (a hard delete, which clears its own map) and re-run.'
          )
        }
      }
    }
  }

  // ── 7. Counters and settings ──────────────────────────────────────────────

  heading('7. Counters and settings')

  // 🛑 The journal entry counter is reset only when the templates left nothing
  // behind. Zeroing it under a surviving JNL-0003 re-mints that number onto a
  // live record - the same collision the order counter is never touched for.
  const resetScopes: string[] = [...CLEARED_SEQUENCE_SCOPES]
  if (templatesKept === 0) resetScopes.push(CONDITIONAL_SEQUENCE_SCOPE)

  const sequences = await db
    .select({ scope: schema.RecordSequence.scope, n: schema.RecordSequence.currentNumber })
    .from(schema.RecordSequence)
    .where(
      and(
        eq(schema.RecordSequence.organizationId, org.id),
        inArray(schema.RecordSequence.scope, resetScopes)
      )
    )
  for (const s of sequences) console.log(`  ${s.scope} at ${s.n} -> 0`)
  if (templatesKept > 0) {
    console.log(
      `  journal_entry counter LEFT ALONE - ${templatesKept} template(s) still hold numbers`
    )
  }
  console.log(`  ${SETTING_RESETS.length} setting(s) back to their defaults, setupState -> draft`)

  if (!CONFIRM) {
    console.log('\ndry run - nothing was written. Re-run with --confirm.\n')
    return
  }

  // ── 8. Write ──────────────────────────────────────────────────────────────

  heading('8. Writing')

  for (const p of postings) {
    await db
      .delete(schema.GlPosting)
      .where(and(eq(schema.GlPosting.id, p.id), eq(schema.GlPosting.organizationId, org.id)))
  }
  console.log(`deleted ${postings.length} GlPosting row(s); their lines cascaded`)

  const stampFieldIds = [...stampFields.values()]
  if (stampFieldIds.length > 0) {
    await db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          inArray(schema.FieldValue.fieldId, stampFieldIds)
        )
      )
  }
  console.log(`cleared ${stampRows} posting stamp(s) on surviving records`)

  const deletableIds = [
    ...DELETE_WAVES.flat().flatMap((type) => idsByType.get(type) ?? []),
    ...journalEntryIds,
  ]
  if (deletableIds.length > 0) {
    await db
      .delete(schema.RecordRuleRun)
      .where(
        and(
          eq(schema.RecordRuleRun.organizationId, org.id),
          inArray(schema.RecordRuleRun.entityInstanceId, deletableIds)
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
    console.log(`wave ${index + 1} (${wave.join(', ')}): deleted ${waveCount} record(s)`)
  }

  if (journalEntryIds.length > 0) {
    const result = await deleteEntityInstances({ ids: journalEntryIds, organizationId: org.id })
    if (result.isErr()) {
      console.error(`\n🛑 journal_entry delete failed: ${result.error.message}`)
      process.exit(1)
    }
    console.log(`deleted ${result.value.count} journal entry record(s), ${templatesKept} kept`)
  }

  // 🛑 Same phase as the movements, never a later one. See the header.
  const rollupAndMarkerIds = [...rollupFields.values(), ...markerFields.values()]
  if (rollupAndMarkerIds.length > 0) {
    await db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          inArray(schema.FieldValue.fieldId, rollupAndMarkerIds)
        )
      )
  }
  console.log('cleared derived roll-ups and per-record markers')

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
  if (hasPostedFieldId) {
    await db
      .update(schema.FieldValue)
      .set({ valueBoolean: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          eq(schema.FieldValue.fieldId, hasPostedFieldId)
        )
      )
  }
  console.log('quantity on hand zeroed, stock status out_of_stock, has_posted false')

  // 🛑 BEFORE the chart wipe, never after. The map lives in a `qboAccountId`
  // cell ON the `gl_account` instance, mirrored into `RecordIdentity`, and
  // `RecordIdentity.entityInstanceId` is ON DELETE CASCADE. Clearing it after
  // the wipe means the cascade already did it: every call is a no-op against a
  // row that no longer exists, and the count printed below is fiction. The end
  // state happens to be identical, which is exactly what makes it a bad thing
  // to rely on - under `--keep-chart` there is no cascade to fall back on.
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

  if (!KEEP_CHART) {
    const pointerFieldIds = [...pointerFields.values()]
    if (pointerFieldIds.length > 0) {
      await db
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, org.id),
            inArray(schema.FieldValue.fieldId, pointerFieldIds)
          )
        )
    }

    // Ask the guard itself rather than trusting the list above. A pointer
    // attribute this script does not know about would otherwise be wiped into a
    // dangling id - the exact 2026-09-11 failure.
    if (chartIds.length > 0) {
      const remaining = await findGlAccountPointers(db, org.id, chartIds)
      if (remaining.length > 0) {
        console.error(
          `\n🛑 STOPPING before the chart wipe. ${remaining.length} record(s) still point at an\n` +
            '   account through a field this script does not clear. Add the attribute to\n' +
            '   CHART_POINTER_ATTRIBUTES and re-run; wiping now would leave a dangling id.\n'
        )
        for (const p of remaining) console.error(`   ${p.label} (${p.attribute})`)
        process.exit(1)
      }

      // `FieldValue` has no foreign key to `EntityInstance`, so its rows go
      // first - an orphaned value row outlives its instance and becomes
      // unreachable rather than merely wrong.
      await db.delete(schema.FieldValue).where(inArray(schema.FieldValue.entityId, chartIds))
      await db.delete(schema.EntityInstance).where(inArray(schema.EntityInstance.id, chartIds))
    }
    await db
      .delete(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, org.id))
    console.log(
      `deleted ${chartIds.length} account(s), ${roleAssignments} role assignment(s), ` +
        `${pointerRows} pointer(s)`
    )
  }

  await db
    .update(schema.RecordSequence)
    .set({ currentNumber: 0, updatedAt: new Date() })
    .where(
      and(
        eq(schema.RecordSequence.organizationId, org.id),
        inArray(schema.RecordSequence.scope, resetScopes)
      )
    )
  console.log(`reset ${sequences.length} record counter(s) to 0`)

  await batchUpdateOrganizationSettings({ organizationId: org.id, settings: SETTING_RESETS })
  // 🛑 The ROUTER's job when a human does this, not this script's.
  // `batchUpdateOrganizationSettings` does not bust the `orgSettings` cache, and
  // the key's TTL is a day - skipping the event leaves the wizard reading
  // `finalized` out of Redis long after the row says `draft`.
  await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
  console.log(`reset ${SETTING_RESETS.length} setting(s)`)

  await getOrgCache().invalidateAndRecompute(org.id, ['resources', 'customFields', 'orgSettings'])
  console.log('org cache invalidated')

  console.log(
    '\ndone.\n\n' +
      `  ${postings.length} posting(s), ${instanceTotal} derived record(s), ` +
      `${stampRows} stamp(s)\n` +
      `  ${chartIds.length} account(s), ${mappings.length} map entry(s), ` +
      `${SETTING_RESETS.length} setting(s)\n` +
      `  ${connectorItems?.n ?? 0} connector binding(s) untouched\n\n` +
      'Re-drive, IN THIS ORDER:\n\n' +
      '  1. Accounting setup wizard. Provision chart, cutoff period, opening balances,\n' +
      '     connect the fresh QuickBooks sandbox, map the accounts. Nothing posts until\n' +
      '     setupState is finalized.\n' +
      '  2. Builds backfill (Builds -> Backfill). Writes build_produce / build_consume\n' +
      '     movements dated from the PERIOD, not from today.\n' +
      '  3. scripts/backfill-relief.ts. Writes the sale movements.\n' +
      '     🛑 AFTER step 2, never before: relief prices at the ledger average and falls\n' +
      '     back to standard cost only when on-hand is <= 0, so with no build_produce\n' +
      '     movements yet every line prices off the fallback or is skipped silently.\n' +
      '  4. Bulk fulfillment posting, and batch credit memo posting. Both read a null\n' +
      '     stamp as unposted, so every surviving fulfillment and Shopify refund is a\n' +
      '     candidate again.\n' +
      '  5. Month-end close. Inventory and COGS reach the ledger only here under L1.\n\n' +
      '  Shopify is NOT re-synced at any point.\n'
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
