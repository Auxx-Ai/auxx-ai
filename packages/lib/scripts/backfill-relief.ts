// packages/lib/scripts/backfill-relief.ts
//
// Relieve inventory for every fulfillment an organization already holds.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/backfill-relief.ts DemoOrg1
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/backfill-relief.ts DemoOrg1 --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// ── Why a script and not a re-sync ──────────────────────────────────────────
//
// 🛑 Relief's two production callers both fire on ARRIVAL: a new dispatch made
// in the app, or a sync manifest naming a fulfillment that just landed. A
// fulfillment already on disk with an unchanged `contentHash` is counted
// `skipped` by the connector, never enters the manifest, and is never
// relieved - no matter how many times the connector is re-synced. This is the
// door that works off the records instead.
//
// ── Safe to run repeatedly ──────────────────────────────────────────────────
//
// Relief's delta is `quantity - (quantity_relieved ?? 0)`, so a line already
// relieved writes nothing and lands in `skippedZeroDelta`. There is no cursor
// and no watermark to keep.
//
// ── Run it AFTER the builds backfill ────────────────────────────────────────
//
// 🛑 Relief prices at the part's frozen `part_standard_cost` and nothing else.
// A line whose part has none is skipped (`skippedNoCost`) and its dispatch is
// parked in Blocked as `STANDARD_COST_MISSING`; set or roll the standards, and
// run the builds backfill for assembled parts, before this.

import { database as db, schema } from '@auxx/database'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { requireCachedEntityDefId } from '../src/cache'
import { backfillFulfillmentRelief } from '../src/inventory/relief'

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)
const CONFIRM = args.includes('--confirm')

if (!ORG_ARG) {
  console.error(
    'usage: backfill-relief.ts <organizationId|name> [--confirm]\n\n' +
      '    --confirm   actually write the sale movements. Without it this only\n' +
      '                reports what is owed.\n'
  )
  process.exit(1)
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

/** Rows of one entity type for this org. */
async function countInstances(organizationId: string, entityType: string): Promise<number> {
  const defId = await requireCachedEntityDefId(organizationId, entityType)
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return row?.n ?? 0
}

/** `FieldValue` rows for one system attribute. */
async function countAttribute(organizationId: string, attribute: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, attribute)
      )
    )
  return row?.n ?? 0
}

/** `sale` movements the org holds right now, by movement type. */
async function countSaleMovements(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'stock_movement_type'),
        inArray(schema.FieldValue.optionId, ['sale'])
      )
    )
  return row?.n ?? 0
}

async function main() {
  const org = await resolveOrg()

  const [orders, fulfillments, lines, relievedRows, saleMovements] = await Promise.all([
    countInstances(org.id, 'order'),
    countInstances(org.id, 'fulfillment'),
    countInstances(org.id, 'fulfillment_line'),
    countAttribute(org.id, 'fulfillment_line_quantity_relieved'),
    countSaleMovements(org.id),
  ])

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`mode         ${CONFIRM ? 'WRITE' : 'dry run (pass --confirm to write)'}\n`)
  console.log(`  orders                 ${orders}`)
  console.log(`  fulfillments           ${fulfillments}`)
  console.log(`  fulfillment lines      ${lines}`)
  console.log(`  lines with a roll-up   ${relievedRows}`)
  console.log(`  sale movements on disk ${saleMovements}`)

  // 🛑 The one state this cannot fix, and reports instead of silently
  // succeeding over. A roll-up left standing after its movements were deleted
  // makes the delta zero, so relief writes nothing and calls it a clean run.
  if (relievedRows > 0 && saleMovements === 0) {
    console.error(
      `\n🛑 REFUSING. ${relievedRows} line(s) carry a quantity_relieved roll-up and the org\n` +
        '   holds ZERO sale movements. The roll-up is a re-SUM of those movements, so this\n' +
        "   state means they were deleted without it being cleared - and relief's delta\n" +
        '   (quantity - quantity_relieved) is then zero for every one of those lines.\n\n' +
        '   This run would report success having written nothing. Clear the roll-up first:\n' +
        '   scripts/reset-books-keep-source.ts does it in the same phase as the delete.\n'
    )
    process.exit(1)
  }

  if (!CONFIRM) {
    console.log('\ndry run - nothing was written. Re-run with --confirm.\n')
    return
  }

  console.log('')
  const result = await backfillFulfillmentRelief(db, {
    organizationId: org.id,
    onBatch: (p) => {
      process.stdout.write(
        `\r  batch ${p.batch}/${p.batches}  orders ${p.ordersDone}/${orders}  ` +
          `movements ${p.movementsWritten}   `
      )
    },
  })
  process.stdout.write('\n\n')

  if (result.isErr()) {
    console.error(`🛑 ${result.error.message}`)
    process.exit(1)
  }

  const s = result.value
  console.log(`  orders scanned          ${s.ordersScanned}`)
  console.log(`  fulfillments scanned    ${s.fulfillmentsScanned}`)
  console.log(`  cancelled, skipped      ${s.fulfillmentsSkippedCancelled}`)
  console.log(`  lines considered        ${s.linesConsidered}`)
  console.log(`  MOVEMENTS WRITTEN       ${s.movementsWritten}`)
  console.log(`  parts recalculated      ${s.affectedPartIds.length}`)
  console.log(`  skipped, no part        ${s.skippedNoPart}`)
  console.log(`  skipped, already done   ${s.skippedZeroDelta}`)
  console.log(`  skipped, NO COST        ${s.skippedNoCost}`)
  console.log(`  negative QoH            ${s.negativeQoHPartIds.length} part(s)`)
  console.log(`  batches failed          ${s.batchesFailed}`)

  if (s.skippedNoCost > 0) {
    console.log(
      '\n⚠️  Some lines could not be priced: their part has no standard cost. If the\n' +
        '   builds backfill has not run yet, that is why - run it and re-run this;\n' +
        '   the lines that were skipped are still owed and will be picked up.'
    )
  }
  if (s.batchesFailed > 0) {
    console.log(
      `\n⚠️  ${s.batchesFailed} batch(es) failed, so this summary is partial. Re-running is\n` +
        '   free: a line already relieved writes nothing.'
    )
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
