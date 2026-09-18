// packages/lib/scripts/bridge-financial-records.ts
//
// The one-time fill for brief 69 (`plans/accounting/tasks/69-the-evidence-bridge.md` §5).
// Walks every financial record an organization has, 250 a page, through
// `bridgeFinancialRecords`, then assesses the payouts it touched.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/bridge-financial-records.ts --org DemoOrg1 --dry-run
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/bridge-financial-records.ts --org DemoOrg1
//
// `--org` is an organization id, or a name to match. `--dry-run` counts the
// records a live run would walk and writes nothing.

import { database as db, schema } from '@auxx/database'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import {
  type BridgeKindCounts,
  type BridgeRecordKind,
  bridgeFinancialRecords,
} from '../src/accounting/money/customer-money/bridge'
import { assessPayouts } from '../src/accounting/money/payouts/assess-payouts'

const PAGE_SIZE = 250
const KINDS: BridgeRecordKind[] = [
  'payout',
  'processor_balance_entry',
  'customer_transaction',
  'order',
]

const args = process.argv.slice(2)
const flag = (name: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? '') : '')
const ORG_ARG = flag('--org')
const KIND_ARG = flag('--kind')
const DRY_RUN = args.includes('--dry-run')

if (!ORG_ARG || (KIND_ARG && !KINDS.includes(KIND_ARG as BridgeRecordKind))) {
  console.error(
    'usage: bridge-financial-records.ts --org <organizationId|name> [--kind <k>] [--dry-run]\n\n' +
      `  --kind     one of ${KINDS.join(', ')}; every kind when omitted\n` +
      '  --dry-run  count the records a live run would walk, write nothing\n'
  )
  process.exit(1)
}

/** Resolve `--org` as an id first, then as a name. */
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

async function resolveDefIds(organizationId: string): Promise<Map<BridgeRecordKind, string>> {
  const rows = await db
    .select({ id: schema.EntityDefinition.id, entityType: schema.EntityDefinition.entityType })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        inArray(schema.EntityDefinition.entityType, KINDS)
      )
    )
  return new Map(
    rows.flatMap((row) => (row.entityType ? [[row.entityType as BridgeRecordKind, row.id]] : []))
  )
}

/** One keyset page of live instances of a def. */
async function page(organizationId: string, defId: string, after: string | null) {
  return db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, defId),
        isNull(schema.EntityInstance.archivedAt),
        after ? gt(schema.EntityInstance.id, after) : undefined
      )
    )
    .orderBy(asc(schema.EntityInstance.id))
    .limit(PAGE_SIZE)
}

const merge = (into: BridgeKindCounts, from: BridgeKindCounts) => {
  into.bridged += from.bridged
  into.skipped += from.skipped
  for (const [reason, count] of Object.entries(from.reasons))
    into.reasons[reason] = (into.reasons[reason] ?? 0) + count
  for (const [disposition, count] of Object.entries(from.dispositions))
    into.dispositions[disposition] = (into.dispositions[disposition] ?? 0) + count
}

async function main() {
  const org = await resolveOrg()
  // `customer_transaction` is not in the default walk: bridging an order reads
  // every transaction linked to it, and a transaction linked to no order
  // contributes nothing. `--kind customer_transaction` still runs it.
  const kinds = KIND_ARG
    ? [KIND_ARG as BridgeRecordKind]
    : KINDS.filter((kind) => kind !== 'customer_transaction')
  const defIds = await resolveDefIds(org.id)
  console.log(`\n${org.name ?? org.id} (${org.id})${DRY_RUN ? '  [dry run]' : ''}\n`)

  const payoutIds = new Set<string>()
  let walked = 0

  for (const kind of kinds) {
    const defId = defIds.get(kind)
    if (!defId) {
      console.log(`${kind.padEnd(26)} no definition for this organization`)
      continue
    }
    const counts: BridgeKindCounts = { bridged: 0, skipped: 0, reasons: {}, dispositions: {} }
    let after: string | null = null
    let seen = 0
    while (true) {
      const rows = await page(org.id, defId, after)
      if (!rows.length) break
      seen += rows.length
      walked += rows.length
      if (!DRY_RUN) {
        const result = await bridgeFinancialRecords(db, {
          organizationId: org.id,
          actorUserId: 'system',
          records: rows.map((row) => ({ id: row.id, kind })),
        })
        merge(counts, result[kind])
        // A customer_transaction page also bridges its orders; fold that in.
        if (kind === 'customer_transaction') merge(counts, result.order)
        for (const id of result.payoutInstanceIds) payoutIds.add(id)
      }
      after = rows.at(-1)!.id
      process.stdout.write(`\r${kind.padEnd(26)} ${seen} walked`)
    }
    process.stdout.write('\r')
    const dispositions = Object.entries(counts.dispositions)
      .map(([name, count]) => `${name} ${count}`)
      .join(', ')
    console.log(
      `${kind.padEnd(26)} ${String(seen).padStart(6)} walked  ` +
        `${String(counts.bridged).padStart(6)} bridged  ${String(counts.skipped).padStart(5)} skipped` +
        (dispositions ? `  [${dispositions}]` : '')
    )
    for (const [reason, count] of Object.entries(counts.reasons))
      console.log(`${' '.repeat(28)}skipped ${count}: ${reason}`)
  }

  if (!DRY_RUN && payoutIds.size) {
    console.log(`\nassessing ${payoutIds.size} payout owner(s)…`)
    await assessPayouts(db, org.id, [...payoutIds])
  }

  console.log(
    `\ndone. ${walked} record(s) walked` +
      (DRY_RUN ? '. Re-run without --dry-run to write.\n' : '.\n')
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
