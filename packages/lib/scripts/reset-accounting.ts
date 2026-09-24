// packages/lib/scripts/reset-accounting.ts
//
// 🛑 DEV-ONLY. Returns one organization's ACCOUNTING state to zero so the whole
// flow - wizard, chart, opening balances, export, close - can be driven again.
// Source documents (orders, fulfillments, payouts, bank transactions, the money
// model) and the book connection are never touched.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-accounting.ts DemoOrg1 --all --wizard --chart
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-accounting.ts DemoOrg1 --all --wizard --chart --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// Guards:
//
// 1. A posting in a SENT export batch REFUSES without `--force`: deleting our
//    row orphans a real object at the provider.
// 2. Delete order is descending `revision`. `GlPosting.reversesId` is ON DELETE
//    RESTRICT, so a reversal has to go before the row it reverses.
// 3. `--period` additionally refuses when a row OUTSIDE the selection reverses
//    a row INSIDE it, which the RESTRICT would otherwise reject halfway through.
// 4. The QuickBooks map is cleared through `clearQuickbooksAccountMapping` BEFORE
//    the chart goes, so the `RecordIdentity` mirror goes with the cell rather
//    than by cascade.
// 5. `--chart` clears the text pointers at the chart (`bank_account_gl_account`
//    and friends) first, then asks `findGlAccountPointers` to prove nothing is
//    left - a wipe that leaves a dangling account id refuses the next posting.
// 6. `--wizard` fires `org.settings.changed` itself; `batchUpdateOrganizationSettings`
//    does not bust the `orgSettings` cache, the settings router does.

import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { listChartAccounts } from '../src/accounting/ledger'
import { findGlAccountPointers } from '../src/accounting/ledger/chart/gl-account-pointers'
import { setLockedThrough } from '../src/accounting/ledger/periods/set-locked-through'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/accounting/providers/quickbooks/account-map'
import { getOrgCache } from '../src/cache'
import { onCacheEvent } from '../src/cache/invalidate'
import { deleteEntityInstances } from '../src/entity-instances'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

// `GlPostingSource` cascades on `GlPosting` delete, so the claim itself needs no
// release. `ExportBatchPosting` is `ON DELETE NO ACTION` against the posting, so
// a batched posting still has to be cleared first (TARGET §3).
async function releaseExportBatchRows(
  organizationId: string,
  glPostingIds: readonly string[]
): Promise<number> {
  if (!glPostingIds.length) return 0
  const members = await db
    .select({ batchId: schema.ExportBatchPosting.batchId })
    .from(schema.ExportBatchPosting)
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        inArray(schema.ExportBatchPosting.glPostingId, [...glPostingIds])
      )
    )
  const batchIds = [...new Set(members.map((row) => row.batchId))]
  if (!batchIds.length) return 0
  await db
    .delete(schema.ExportBatchPosting)
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        inArray(schema.ExportBatchPosting.batchId, batchIds)
      )
    )
  await db
    .delete(schema.ExportBatch)
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        inArray(schema.ExportBatch.id, batchIds)
      )
    )
  return batchIds.length
}

/** Which of these postings a SENT batch already put in the provider's books. */
async function readSentProviderObjects(
  organizationId: string,
  glPostingIds: readonly string[]
): Promise<Map<string, string>> {
  if (!glPostingIds.length) return new Map()
  const rows = await db
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
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        inArray(schema.ExportBatchPosting.glPostingId, [...glPostingIds]),
        eq(schema.ExportBatch.state, 'sent')
      )
    )
  const sent = new Map<string, string>()
  for (const row of rows) if (row.providerObjectId) sent.set(row.glPostingId, row.providerObjectId)
  return sent
}

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)

const ALL = args.includes('--all')
const PERIOD = args.includes('--period') ? (args[args.indexOf('--period') + 1] ?? '') : ''
const WIZARD = args.includes('--wizard')
const CHART = args.includes('--chart')
const KEEP_MAP = args.includes('--keep-map')
const FORCE = args.includes('--force')
const CONFIRM = args.includes('--confirm')

const selectors = [ALL, !!PERIOD].filter(Boolean).length

if (!ORG_ARG || selectors !== 1 || (CHART && !ALL && !FORCE)) {
  console.error(
    'usage: reset-accounting.ts <organizationId|name> <selector> [options]\n\n' +
      '  selectors, exactly one:\n' +
      '    --period <key>    delete one period key, any shape (2026-08, DEP-0003, INV-0012)\n' +
      '    --all             delete every posting, export batch, mirror entry and work item this\n' +
      '                      organization has\n\n' +
      '  options:\n' +
      '    --wizard          also return the setup wizard, the opening baseline and the\n' +
      '                      provider sync marker to draft\n' +
      '    --chart           also delete the chart of accounts, its role assignments and\n' +
      '                      the bank-side pointers at it (needs --all)\n' +
      '    --keep-map        do not clear the QuickBooks account map\n' +
      '    --force           past the sent-batch and remaining-postings guards\n' +
      '    --confirm         actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

/**
 * Every key the wizard, the close and the inbound sync write, returned to its
 * catalog default. A key belongs here when a posting delete makes its value a
 * lie: `providerSyncedThrough` claims a range the mirror no longer covers, and
 * the opening keys describe a baseline the delete removed. `openingSource`
 * resets to `'manual'`, its real catalog default.
 */
const WIZARD_KEYS = [
  { key: 'accounting.setupState' as const, value: 'draft' },
  { key: 'accounting.setupFinalizedAt' as const, value: null },
  { key: 'accounting.setupFinalizedByUserId' as const, value: null },
  { key: 'accounting.cutoffPeriod' as const, value: null },
  { key: 'accounting.bookTimeZone' as const, value: null },
  { key: 'accounting.openingSource' as const, value: 'manual' },
  { key: 'accounting.openingSourceAsOf' as const, value: null },
  { key: 'accounting.providerSyncedThrough' as const, value: null },
]

/**
 * TEXT pointers at a `gl_account` instance, cleared before the chart goes.
 * Mirrors `GL_ACCOUNT_POINTER_ATTRIBUTES`; the guard re-asks that helper after
 * the clear, so a pointer this list misses stops the wipe instead of dangling.
 */
const CHART_POINTER_ATTRIBUTES = [
  'bank_account_gl_account',
  'bank_rule_gl_account',
  'bank_transaction_gl_account',
  'bank_transaction_suggested_gl_account',
  'vendor_bill_line_gl_account',
] as const

/** Watermarks the payout and fee postings stamp on a rail; a lie once those postings go. */
const RAIL_MARKER_ATTRIBUTES = [
  'payment_gateway_last_settlement_at',
  'payment_gateway_last_fee_booked_at',
] as const

const QUICKBOOKS_APP_SLUG = 'quickbooks'

function money(minor: number | bigint | null): string {
  if (minor === null) return '-'
  return `$${(Number(minor) / 100).toFixed(2)}`
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
 * through `resolveQuickbooksContext`: that helper answers `connected: false`
 * when the app deployment cannot be resolved, and a cleanup tool must not
 * refuse to clear the map because the bundle is broken.
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

/** `systemAttribute -> CustomField.id` for the attributes this org has. */
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
  const map = new Map<string, string>()
  for (const row of rows) if (row.attribute) map.set(row.attribute, row.id)
  return map
}

async function countRows(organizationId: string, fieldIds: readonly string[]): Promise<number> {
  if (!fieldIds.length) return 0
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

async function main() {
  const org = await resolveOrg()
  const scope = ALL ? 'every posting' : `period ${PERIOD}`

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`selection    ${scope}`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to write)'}`)
  console.log(
    `also         ${
      [
        KEEP_MAP ? null : 'clear QuickBooks account map',
        CHART ? 'delete the chart of accounts' : null,
        WIZARD ? 'reopen the setup wizard' : null,
      ]
        .filter(Boolean)
        .join(', ') || 'nothing'
    }`
  )
  console.log(
    'keeps        source documents, the money model, bank accounts, the book connection\n'
  )

  // ── 1. The postings in scope ──────────────────────────────────────────────

  const where = [eq(schema.GlPosting.organizationId, org.id)]
  if (PERIOD) where.push(eq(schema.GlPosting.periodKey, PERIOD))

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
    .where(and(...where))
    // Descending revision is also the delete order `reversesId`'s RESTRICT forces.
    .orderBy(desc(schema.GlPosting.revision))

  const sentObjects = await readSentProviderObjects(
    org.id,
    postings.map((p) => p.id)
  )

  if (postings.length === 0) {
    console.log('postings: none in scope - already clean\n')
  } else {
    console.log(`postings: ${postings.length} row(s), highest revision first`)
    for (const p of postings) {
      const sent = sentObjects.get(p.id)
      console.log(
        `  ${p.status.padEnd(8)} rev${p.revision} ${p.postingType.padEnd(19)}` +
          ` ${(p.docNumber ?? '').padEnd(22)} ${money(p.totalMinor).padStart(13)}` +
          `${sent ? ` SENT as ${sent}` : ''}`
      )
    }
    console.log('')
  }

  // ── 2. Guard: anything already on the provider ────────────────────────────

  const exportedRows = postings.filter((p) => sentObjects.has(p.id))
  if (exportedRows.length > 0 && !FORCE) {
    console.error(
      `🛑 REFUSING. ${exportedRows.length} posting(s) sit in a SENT export batch and are already in\n` +
        '   the accounting system. Deleting our row orphans a real object over there.\n\n' +
        '   Roll the batch back in the app, or pass --force once you have deleted them by hand.\n'
    )
    process.exit(1)
  }
  if (exportedRows.length > 0) {
    console.log(
      `⚠️  --force: deleting ${exportedRows.length} posting(s) that DID reach the provider.\n`
    )
  }

  // ── 3. Guard: a reversal outside the selection ────────────────────────────

  if (postings.length > 0 && !ALL) {
    const ids = postings.map((p) => p.id)
    const dependants = await db
      .select({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        reversesId: schema.GlPosting.reversesId,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, org.id),
          isNotNull(schema.GlPosting.reversesId),
          inArray(schema.GlPosting.reversesId, ids)
        )
      )

    const outside = dependants.filter((d) => !ids.includes(d.id))
    if (outside.length > 0 && !FORCE) {
      console.error(
        `🛑 REFUSING. ${outside.length} posting(s) OUTSIDE this selection reverse a row inside it.\n` +
          '   GlPosting.reversesId is ON DELETE RESTRICT, so the delete would fail partway.\n'
      )
      for (const d of outside) console.error(`   ${d.docNumber} reverses ${d.reversesId}`)
      console.error('\n   Widen the selection (--all), or pass --force.\n')
      process.exit(1)
    }
  }

  // ── 4. Batches left over, and the mirror ──────────────────────────────────
  //
  // A withdrawn batch keeps its membership rows, so `releaseExportBatchRows`
  // reaches it through the posting. Under `--all` the count is the whole table.

  let batchCount = 0
  let mirrorCount = 0
  let workItemCount = 0
  if (ALL) {
    const [batches] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ExportBatch)
      .where(eq(schema.ExportBatch.organizationId, org.id))
    batchCount = batches?.n ?? 0
    const [mirror] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ProviderLedgerEntry)
      .where(eq(schema.ProviderLedgerEntry.organizationId, org.id))
    mirrorCount = mirror?.n ?? 0
    const [work] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.AccountingWorkItem)
      .where(eq(schema.AccountingWorkItem.organizationId, org.id))
    workItemCount = work?.n ?? 0
    console.log(`export batches: ${batchCount}, all states`)
    console.log(`mirror: ${mirrorCount} provider ledger entr${mirrorCount === 1 ? 'y' : 'ies'}`)
    console.log(`work items: ${workItemCount}\n`)
  }

  // ── 5. The account map ────────────────────────────────────────────────────

  let mappings: { glAccountId: string; code: string; name: string; providerAccountId: string }[] =
    []
  let connection: { installationId: string; connectionId: string } | null = null

  if (!KEEP_MAP) {
    connection = await resolveQuickbooksConnection(org.id)
    if (!connection) {
      console.log('account map: no QuickBooks connection for this org - nothing to clear\n')
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
        console.log('account map: empty\n')
      } else {
        console.log(`account map: ${mappings.length} mapped account(s)`)
        for (const m of mappings) {
          console.log(`  ${m.code.padEnd(6)} ${m.name.padEnd(40)} -> ${m.providerAccountId}`)
        }
        console.log('')
      }
    }
  }

  // ── 6. The chart ──────────────────────────────────────────────────────────

  let chartIds: string[] = []
  let roleAssignments = 0
  let pointerFields = new Map<string, string>()
  let pointerRows = 0

  if (CHART) {
    const rows = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, org.id),
          eq(schema.EntityDefinition.entityType, 'gl_account')
        )
      )
    chartIds = rows.map((r) => r.id)

    const [roles] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, org.id))
    roleAssignments = roles?.n ?? 0

    pointerFields = await resolveFieldIds(org.id, CHART_POINTER_ATTRIBUTES)
    console.log(`chart: ${chartIds.length} account(s), ${roleAssignments} role assignment(s)`)
    for (const attribute of CHART_POINTER_ATTRIBUTES) {
      const fieldId = pointerFields.get(attribute)
      if (!fieldId) continue
      const n = await countRows(org.id, [fieldId])
      pointerRows += n
      if (n > 0) console.log(`  ${String(n).padStart(4)} ${attribute} -> cleared`)
    }
    if (KEEP_MAP && mappings.length === 0 && chartIds.length > 0) {
      console.log('  ⚠️ --keep-map with --chart: the map lives on the chart rows and goes with them')
    }
    console.log('')
  }

  // ── 7. Markers and settings ───────────────────────────────────────────────

  const markerFields = ALL
    ? await resolveFieldIds(org.id, ['bank_account_has_posted', ...RAIL_MARKER_ATTRIBUTES])
    : new Map<string, string>()
  const hasPostedFieldId = markerFields.get('bank_account_has_posted')
  const railMarkerFieldIds = RAIL_MARKER_ATTRIBUTES.map((a) => markerFields.get(a)).filter(
    (id): id is string => !!id
  )
  const railMarkerRows = await countRows(org.id, railMarkerFieldIds)
  if (railMarkerRows > 0) {
    console.log(`payment gateways: ${railMarkerRows} settlement/fee marker(s) -> cleared\n`)
  }
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
    if (hasPostedRows > 0) {
      console.log(`bank accounts: ${hasPostedRows} stamped has_posted -> false\n`)
    }
  }

  if (WIZARD) {
    console.log(
      `settings: ${WIZARD_KEYS.length + 1} key(s) back to their defaults, setupState -> draft\n`
    )
  }

  if (!CONFIRM) {
    console.log('dry run - nothing was written. Re-run with --confirm.\n')
    return
  }

  // ── 8. Do it ──────────────────────────────────────────────────────────────

  // Batches first: `ExportBatchPosting`'s FK to the posting is ON DELETE NO
  // ACTION. `GlPostingSource` cascades, so the claim needs nothing here.
  const releasedBatches = await releaseExportBatchRows(
    org.id,
    postings.map((p) => p.id)
  )
  if (releasedBatches) console.log(`released ${releasedBatches} export batch(es)`)

  for (const p of postings) {
    await db
      .delete(schema.GlPosting)
      .where(and(eq(schema.GlPosting.id, p.id), eq(schema.GlPosting.organizationId, org.id)))
    console.log(`deleted ${p.docNumber ?? p.id} (${p.status} rev${p.revision})`)
  }

  if (ALL) {
    await db
      .delete(schema.ExportBatchPosting)
      .where(eq(schema.ExportBatchPosting.organizationId, org.id))
    await db.delete(schema.ExportBatch).where(eq(schema.ExportBatch.organizationId, org.id))
    // Lines cascade.
    await db
      .delete(schema.ProviderLedgerEntry)
      .where(eq(schema.ProviderLedgerEntry.organizationId, org.id))
    // A parked item (e.g. REFUND_EXCEEDS_MEMO) would otherwise keep its source from being re-offered.
    await db
      .delete(schema.AccountingWorkItem)
      .where(eq(schema.AccountingWorkItem.organizationId, org.id))
    console.log(
      `deleted ${batchCount} export batch(es), ${mirrorCount} mirror entr(ies) and ${workItemCount} work item(s)`
    )
  }

  // BEFORE the chart wipe: the map is a cell on the `gl_account` row mirrored
  // into `RecordIdentity`, and the cascade would otherwise make every call below
  // a no-op against a row that is already gone.
  if (connection) {
    for (const m of mappings) {
      await clearQuickbooksAccountMapping({
        organizationId: org.id,
        installationId: connection.installationId,
        connectionId: connection.connectionId,
        glAccountId: m.glAccountId,
      })
      console.log(`cleared mapping ${m.code} -> ${m.providerAccountId}`)
    }
  }

  if (CHART) {
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
      const deleted = await deleteEntityInstances({ ids: chartIds, organizationId: org.id })
      if (deleted.isErr()) {
        console.error(`\n🛑 chart wipe failed: ${deleted.error.message}`)
        process.exit(1)
      }
    }
    await db
      .delete(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, org.id))
    console.log(
      `deleted ${chartIds.length} account(s), ${roleAssignments} role assignment(s), ${pointerRows} pointer(s)`
    )
  }

  if (railMarkerRows > 0) {
    await db
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          inArray(schema.FieldValue.fieldId, railMarkerFieldIds)
        )
      )
    console.log(`cleared ${railMarkerRows} payment gateway marker(s)`)
  }

  if (hasPostedFieldId && hasPostedRows > 0) {
    await db
      .update(schema.FieldValue)
      .set({ valueBoolean: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.FieldValue.organizationId, org.id),
          eq(schema.FieldValue.fieldId, hasPostedFieldId)
        )
      )
    console.log(`bank_account_has_posted -> false on ${hasPostedRows} account(s)`)
  }

  // AFTER the deletes, so the remaining-postings check sees the world this run
  // leaves behind rather than the one it found.
  let reopened = false
  if (WIZARD) {
    const [remaining] = await db
      .select({ id: schema.GlPosting.id })
      .from(schema.GlPosting)
      .where(eq(schema.GlPosting.organizationId, org.id))
      .limit(1)

    if (remaining && !FORCE) {
      console.error(
        '\n🛑 NOT reopening the wizard. Postings still exist for this organization.\n' +
          '   Reopening the opening baseline underneath a posted entry rewrites the arithmetic\n' +
          '   behind it, which is the edit the settings freeze exists to prevent.\n' +
          '   Re-run with --all, or pass --force.\n'
      )
    } else {
      await batchUpdateOrganizationSettings({ organizationId: org.id, settings: WIZARD_KEYS })
      // The period lock refuses the settings door; it has its own audited command.
      await setLockedThrough(db, { organizationId: org.id, periodKey: null, actorUserId: 'system' })
      await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
      reopened = true
      console.log(`reset ${WIZARD_KEYS.length + 1} setting(s); accounting.setupState is draft`)
    }
  }

  // The chart and its counts are served from the org cache.
  await getOrgCache().invalidateAndRecompute(org.id, ['resources', 'customFields', 'orgSettings'])

  console.log(
    `\ndone. ${postings.length} posting(s), ${mappings.length} mapping(s)` +
      `${CHART ? `, ${chartIds.length} account(s)` : ''}${reopened ? ', wizard reopened' : ''}.\n` +
      (postings.length > 0
        ? 'Those period keys are unclaimed - the documents can be posted again.\n'
        : '') +
      (CHART
        ? 'The chart is empty: Provision chart or Import from the provider in the setup wizard,\nthen re-link the bank accounts to their GL accounts.\n'
        : mappings.length > 0
          ? 'The account map is empty, so the first export refuses until the accounts are re-mapped.\n'
          : '') +
      (reopened ? 'The wizard reruns from page 1 and the opening baseline is editable.\n' : '')
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
