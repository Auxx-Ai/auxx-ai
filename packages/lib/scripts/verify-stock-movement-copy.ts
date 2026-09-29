// packages/lib/scripts/verify-stock-movement-copy.ts
//
// Read-only check of data migration 201 (plans/mrp/20-stock-movement-table.md §6): per org, the
// movement count and, per part, SUM(quantity) without explosion parents and SUM(extended cost),
// from the EAV `stock_movement` entity (while it exists) against the `StockMovement` table. The
// migration deletes the EAV, so save a snapshot before it and compare the table to it after:
//
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/verify-stock-movement-copy.ts --save /tmp/movements-before.json
//   # ...run migration 201...
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/verify-stock-movement-copy.ts --compare /tmp/movements-before.json
//
// With neither flag it compares the live EAV to the live table. `--org <id|name>` narrows it.
// It also reports parts whose stored `part_quantity_on_hand` differs from the table's SUM.

import { readFileSync, writeFileSync } from 'node:fs'
import { database, type Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
}
const ORG_FILTER = flag('--org')
const SAVE_PATH = flag('--save')
const COMPARE_PATH = flag('--compare')

/** Quantities are compared to 6 places, amounts to the cent. */
const QTY_EPSILON = 1e-6

interface PartTotals {
  quantity: number
  extendedCost: number
}

interface Ledger {
  count: number
  parts: Record<string, PartTotals>
}

type Snapshot = Record<string, { name: string | null; eav: Ledger | null }>

async function rowsOf<T>(tx: Transaction, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)).rows as T[]
}

async function orgs(tx: Transaction): Promise<{ id: string; name: string | null }[]> {
  return rowsOf(
    tx,
    sql`
    SELECT o.id, o.name FROM "Organization" o
    WHERE (EXISTS (SELECT 1 FROM "EntityDefinition" d
                   WHERE d."organizationId" = o.id AND d."entityType" = 'stock_movement')
       OR EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."organizationId" = o.id))
      ${ORG_FILTER ? sql`AND (o.id = ${ORG_FILTER} OR o.name = ${ORG_FILTER})` : sql``}
    ORDER BY o.name`
  )
}

function toLedger(
  rows: { partId: string; n: string; quantity: string | null; extendedCost: string | null }[]
): Ledger {
  const ledger: Ledger = { count: 0, parts: {} }
  for (const row of rows) {
    ledger.count += Number(row.n)
    ledger.parts[row.partId] = {
      quantity: Number(row.quantity ?? 0),
      extendedCost: Number(row.extendedCost ?? 0),
    }
  }
  return ledger
}

/** The EAV ledger, or null once the def is gone. */
async function eavLedger(tx: Transaction, organizationId: string): Promise<Ledger | null> {
  const [def] = await rowsOf<{ id: string }>(
    tx,
    sql`SELECT id FROM "EntityDefinition"
        WHERE "organizationId" = ${organizationId} AND "entityType" = 'stock_movement' LIMIT 1`
  )
  if (!def) return null
  const field = (attribute: string) => sql`(SELECT id FROM "CustomField"
    WHERE "entityDefinitionId" = ${def.id} AND "systemAttribute" = ${attribute} LIMIT 1)`
  const rows = await rowsOf<{
    partId: string
    n: string
    quantity: string | null
    extendedCost: string | null
  }>(
    tx,
    sql`
    WITH m AS (
      SELECT ei.id,
        max(fv."relatedEntityId") FILTER (WHERE fv."fieldId" = ${field('stock_movement_part')}) AS part,
        max(fv."valueNumber") FILTER (WHERE fv."fieldId" = ${field('stock_movement_quantity')}) AS qty,
        max(fv."valueNumber") FILTER (WHERE fv."fieldId" = ${field('stock_movement_extended_cost')}) AS ext,
        bool_or(fv."valueBoolean") FILTER (WHERE fv."fieldId" = ${field('stock_movement_adjust_subparts')}) AS adjust
      FROM "EntityInstance" ei
      LEFT JOIN "FieldValue" fv ON fv."entityId" = ei.id AND fv."organizationId" = ${organizationId}
      WHERE ei."organizationId" = ${organizationId} AND ei."entityDefinitionId" = ${def.id}
      GROUP BY ei.id
    )
    SELECT COALESCE(part, '(no part)') AS "partId", count(*) AS n,
      SUM(qty) FILTER (WHERE adjust IS NOT TRUE) AS quantity, SUM(ext) AS "extendedCost"
    FROM m GROUP BY 1`
  )
  return toLedger(rows)
}

async function tableLedger(tx: Transaction, organizationId: string): Promise<Ledger> {
  const rows = await rowsOf<{
    partId: string
    n: string
    quantity: string | null
    extendedCost: string | null
  }>(
    tx,
    sql`
    SELECT "partId", count(*) AS n,
      SUM(quantity) FILTER (WHERE NOT "adjustSubparts") AS quantity,
      SUM("extendedCostMinor") AS "extendedCost"
    FROM "StockMovement" WHERE "organizationId" = ${organizationId}
    GROUP BY 1`
  )
  return toLedger(rows)
}

/** Parts whose stored on-hand differs from the table's SUM. */
async function staleQoH(tx: Transaction, organizationId: string): Promise<number> {
  const [row] = await rowsOf<{ n: string }>(
    tx,
    sql`
    WITH sums AS (
      SELECT "partId", SUM(quantity) FILTER (WHERE NOT "adjustSubparts") AS qty
      FROM "StockMovement" WHERE "organizationId" = ${organizationId} GROUP BY 1
    )
    SELECT count(*) AS n FROM sums s
    LEFT JOIN "FieldValue" fv ON fv."entityId" = s."partId" AND fv."fieldId" = (
      SELECT cf.id FROM "CustomField" cf
      WHERE cf."organizationId" = ${organizationId}
        AND cf."systemAttribute" = 'part_quantity_on_hand' LIMIT 1)
    WHERE abs(COALESCE(fv."valueNumber", 0) - COALESCE(s.qty, 0)) > ${QTY_EPSILON}`
  )
  return Number(row?.n ?? 0)
}

/** Printable differences between two ledgers; empty when they agree. */
function diff(expected: Ledger, actual: Ledger): string[] {
  const out: string[] = []
  if (expected.count !== actual.count) out.push(`count ${expected.count} -> ${actual.count}`)
  const partIds = new Set([...Object.keys(expected.parts), ...Object.keys(actual.parts)])
  for (const partId of partIds) {
    const a = expected.parts[partId] ?? { quantity: 0, extendedCost: 0 }
    const b = actual.parts[partId] ?? { quantity: 0, extendedCost: 0 }
    if (Math.abs(a.quantity - b.quantity) > QTY_EPSILON) {
      out.push(`part ${partId} quantity ${a.quantity} -> ${b.quantity}`)
    }
    if (Math.abs(a.extendedCost - b.extendedCost) >= 0.5) {
      out.push(`part ${partId} extended cost ${a.extendedCost} -> ${b.extendedCost}`)
    }
  }
  return out
}

async function main(): Promise<void> {
  const before: Snapshot | null = COMPARE_PATH
    ? (JSON.parse(readFileSync(COMPARE_PATH, 'utf8')) as Snapshot)
    : null
  const snapshot: Snapshot = {}
  let failures = 0

  await database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`)
    const list = await orgs(tx)
    const ids = new Set(list.map((org) => org.id))
    // A saved org the live query no longer finds still has to be checked.
    for (const [id, saved] of Object.entries(before ?? {})) {
      if (!ids.has(id) && (!ORG_FILTER || ORG_FILTER === id)) list.push({ id, name: saved.name })
    }

    for (const org of list) {
      const eav = await eavLedger(tx, org.id)
      const table = await tableLedger(tx, org.id)
      snapshot[org.id] = { name: org.name, eav }

      const expected = before ? (before[org.id]?.eav ?? null) : eav
      const source = before ? 'snapshot' : 'EAV'
      console.log(`\n${org.name ?? '-'} (${org.id})`)
      console.log(
        `  EAV ${eav ? `${eav.count} movement(s)` : 'gone'}   table ${table.count} movement(s)`
      )
      if (!before && table.count === 0) console.log('  table empty: migration 201 not run yet')
      else if (expected) {
        const lines = diff(expected, table)
        if (lines.length === 0)
          console.log(`  ${source} = table: count and every part's sums agree`)
        else {
          failures++
          console.log(`  ${source} != table (${lines.length} difference(s)):`)
          for (const line of lines.slice(0, 20)) console.log(`    ${line}`)
          if (lines.length > 20) console.log(`    ...and ${lines.length - 20} more`)
        }
      } else console.log(`  nothing to compare the table to (no ${source})`)
      const stale = await staleQoH(tx, org.id)
      if (stale > 0) console.log(`  ${stale} part(s) whose stored QoH differs from the table's SUM`)
    }
  })

  if (SAVE_PATH) {
    writeFileSync(SAVE_PATH, JSON.stringify(snapshot))
    console.log(`\nsaved ${Object.keys(snapshot).length} org(s) to ${SAVE_PATH}`)
  }
  console.log(failures === 0 ? '\nOK\n' : `\n${failures} org(s) differ\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
