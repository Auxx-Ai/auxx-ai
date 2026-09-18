// packages/database/scripts/reconcile-local-accounting.ts
//
// Moves a LOCAL database from the abandoned drizzle 0377-0393 chain to the
// squashed 0377_accounting_target. See plans/accounting/MIGRATION.md §0b.
//
// The only raw SQL in the plan, and it is one-off: delete it once every machine
// has run it. Run with `npx dotenv -- npx tsx packages/database/scripts/reconcile-local-accounting.ts`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { ensureDatabaseEnv } from './load-database-env'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'drizzle')
const SNAPSHOT_PATH = path.join(__dirname, '..', '.reconcile-snapshot.json')

/** The last migration that shipped anywhere but a laptop; `when` from `meta/_journal.json`. */
const LAST_SHARED_MIGRATION_IDX = 376

/** Every table the abandoned 0377-0393 chain created. All are recreated by the new 0377 or gone. */
const DROPPED_TABLES = [
  'AccountingDelivery',
  'AccountingDeliveryCoverage',
  'AccountingDeliveryOperation',
  'AccountingEffect',
  'AccountingWork',
  'AccountingWorkBasis',
  'ExternalAccountingBook',
  'ExternalAccountingObject',
  'ExternalBookConnection',
  'FinancialSourceAcceptance',
  'FinancialSourceAccount',
  'FinancialSourceCoverage',
  'FinancialSourceObject',
  'FinancialSourceObservation',
  'MoneyApplication',
  'MoneyCommand',
  'MoneyRefundSettlement',
  'MoneySourceLink',
  'MoneyTransaction',
  'MoneyTransfer',
  'PaymentRoute',
  'ProcessorBalanceEntry',
] as const

/** Every column that chain added to a table which already existed in production. */
const DROPPED_COLUMNS: Array<[table: string, column: string]> = [
  ['GlPosting', 'basis'],
  ['GlPosting', 'deliveryIntent'],
  ['GlPosting', 'intendedBookConnectionId'],
  ['GlRoleAssignment', 'sourceAccountId'],
  ['GlRoleAssignment', 'paymentGatewayId'],
  ['GlRoleAssignment', 'currency'],
]

/** Rows kept across the reset, then written back after the new 0377 lands. */
const SNAPSHOT_TABLES = ['GlRoleAssignment', 'FinancialSourceAccount'] as const

interface Snapshot {
  takenAt: string
  rows: Record<string, Array<Record<string, unknown>>>
}

/** Refuse anywhere but a developer's own machine. This script truncates the ledger. */
function assertLocal(databaseUrl: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reconcile-local-accounting refuses to run with NODE_ENV=production')
  }
  const host = new URL(databaseUrl).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(
      `reconcile-local-accounting refuses a non-local database host '${host}'. ` +
        'It drops tables and truncates GlPosting.'
    )
  }
}

async function snapshot(client: pg.PoolClient): Promise<Snapshot> {
  const rows: Snapshot['rows'] = {}
  for (const table of SNAPSHOT_TABLES) {
    const present = await client.query<{ exists: boolean }>(
      'select to_regclass($1) is not null as exists',
      [`public."${table}"`]
    )
    if (!present.rows[0]?.exists) {
      rows[table] = []
      continue
    }
    const result = await client.query(`select * from "${table}"`)
    rows[table] = result.rows
  }
  return { takenAt: new Date().toISOString(), rows }
}

/**
 * Write the snapshot rows back, column by column, against whatever shape the
 * table has after the new 0377. A column the target no longer holds is dropped
 * silently; that is the point of restoring by name rather than by position.
 */
async function restore(client: pg.PoolClient, table: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return 0
  const live = await client.query<{ column_name: string }>(
    'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
    ['public', table]
  )
  const columns = new Set(live.rows.map((r) => r.column_name))
  let written = 0
  for (const row of rows) {
    const names = Object.keys(row).filter((name) => columns.has(name))
    if (names.length === 0) continue
    const placeholders = names.map((_, i) => `$${i + 1}`).join(', ')
    const quoted = names.map((name) => `"${name}"`).join(', ')
    await client.query(
      `insert into "${table}" (${quoted}) values (${placeholders}) on conflict do nothing`,
      names.map((name) => row[name])
    )
    written += 1
  }
  return written
}

/**
 * Steps 4 and 5 of MIGRATION.md §0b, as of step 1b part D.
 *
 * Step 4 — none of `157`-`167` were deleted outright this wave, so
 * {@link DELETED_MIGRATION_IDS} is empty and there is no ledger row to drop.
 * `152-credit-memo-gl-posting` ran in production and is untouched by this
 * list on purpose: it stays registered (its id is a permanent ledger key -
 * see `registry.ts`'s own `RETIRED_ID_NUMBERS` header), and its `up()` is
 * edited in place to a no-op rather than removed. `157-payout-rail-and-order-
 * payment-fields` is edited too (it no longer provisions `paymentGlPosting`)
 * - also not a deletion, so its row stays as well.
 *
 * Step 5 — the six GL-posting stamp fields 157/152 provisioned (or, for the
 * other four, whatever local seed first added them) are removed by entity
 * data migration `168-remove-gl-posting-stamp-fields`, which is a normal
 * `PER_ORG_MIGRATIONS` entry and goes through `db.delete(schema.CustomField)`
 * in `packages/lib` - the "registry's field-removal helper" §0b means, never
 * raw SQL. This script cannot run it directly: `packages/database` is tier 1
 * and must not import `@auxx/lib` (tier 3). It runs when §0b step 6's data-
 * migration runner (a separate command, after this script) applies pending
 * migrations - `168` is one, for every org this script's caller reconciles.
 */
const DELETED_MIGRATION_IDS: readonly string[] = []

/** The six fields migration 168 removes, named here only for the log line. */
const REMOVED_STAMP_ATTRIBUTES = [
  'fulfillment_gl_posting',
  'credit_memo_gl_posting',
  'payout_gl_posting_id',
  'bank_deposit_gl_posting_id',
  'bank_transaction_gl_posting_id',
  'order_payment_gl_posting',
] as const

async function reconcileDataMigrations(client: pg.PoolClient): Promise<void> {
  if (DELETED_MIGRATION_IDS.length > 0) {
    const deleted = await client.query('delete from "DataMigration" where id = any($1::text[])', [
      DELETED_MIGRATION_IDS,
    ])
    console.log(`🧹 dropped ${deleted.rowCount} DataMigration ledger row(s)`)
  } else {
    console.log('⏭  no migration ids deleted outright this wave - nothing to drop from the ledger')
  }
  console.log(
    `⏭  ${REMOVED_STAMP_ATTRIBUTES.length} GL-posting stamp fields (${REMOVED_STAMP_ATTRIBUTES.join(', ')}) ` +
      'are removed by entity data migration 168, not here - run the data-migration runner next'
  )
}

async function main() {
  ensureDatabaseEnv()
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  assertLocal(databaseUrl)

  const pool = new pg.Pool({ connectionString: databaseUrl })
  const client = await pool.connect()

  try {
    // ── 1. Snapshot the Mapping tab and the store-to-gateway links ──────────
    const taken = await snapshot(client)
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(taken, null, 2))
    for (const table of SNAPSHOT_TABLES) {
      console.log(`📸 ${table}: ${taken.rows[table]?.length ?? 0} rows → ${SNAPSHOT_PATH}`)
    }

    await client.query('begin')

    // ── 2. Undo the abandoned chain ─────────────────────────────────────────
    for (const table of DROPPED_TABLES) {
      await client.query(`drop table if exists "${table}" cascade`)
    }
    for (const [table, column] of DROPPED_COLUMNS) {
      await client.query(`alter table "${table}" drop column if exists "${column}" cascade`)
    }
    // Added by the abandoned 0377 and re-added by the new one.
    await client.query('alter table "GlPosting" drop constraint if exists "GlPosting_org_id_key"')
    // Dropped by the abandoned 0382; the new 0377 drops it again, so it has to be back.
    await client.query(
      'create unique index if not exists "GlRoleAssignment_org_role_key" on "GlRoleAssignment" ("organizationId","role")'
    )
    await client.query('truncate table "GlPosting", "GlPostingLine" cascade')

    // ── 3. Forget the abandoned migrations ──────────────────────────────────
    // `__drizzle_migrations.created_at` is the journal entry's `when`, so the
    // cut is exact without needing the deleted files' hashes.
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')
    ) as { entries: Array<{ idx: number; when: number }> }
    const lastShared = journal.entries.find((e) => e.idx === LAST_SHARED_MIGRATION_IDX)
    if (!lastShared) throw new Error(`No journal entry for idx ${LAST_SHARED_MIGRATION_IDX}`)
    const deleted = await client.query(
      'delete from drizzle."__drizzle_migrations" where created_at > $1',
      [lastShared.when]
    )
    console.log(
      `🧹 dropped ${deleted.rowCount} migration ledger rows after 0${LAST_SHARED_MIGRATION_IDX}`
    )

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  // ── 4. The squashed migration ─────────────────────────────────────────────
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
  console.log('✅ 0377_accounting_target applied')

  const after = await pool.connect()
  try {
    await reconcileDataMigrations(after)

    // ── 5. Put the mapping back ─────────────────────────────────────────────
    // `FinancialSourceAccount` first: `GlRoleAssignment.sourceAccountId` points
    // at it. Ids are restored verbatim, so the link survives; the
    // `(providerKey, externalAccountId)` map below repairs any row a sync
    // re-minted under a new id between the drop and this restore.
    const saved = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot
    const sources = saved.rows.FinancialSourceAccount ?? []
    console.log(
      `♻️  FinancialSourceAccount: ${await restore(after, 'FinancialSourceAccount', sources)} rows`
    )

    const live = await after.query<{ id: string; providerKey: string; externalAccountId: string }>(
      'select id, "providerKey", "externalAccountId" from "FinancialSourceAccount"'
    )
    const byNaturalKey = new Map(
      live.rows.map((r) => [`${r.providerKey} ${r.externalAccountId}`, r.id])
    )
    const sourceIdByOldId = new Map<string, string>()
    for (const row of sources) {
      const key = `${String(row.providerKey)} ${String(row.externalAccountId)}`
      const id = byNaturalKey.get(key)
      if (id) sourceIdByOldId.set(String(row.id), id)
    }

    const assignments = (saved.rows.GlRoleAssignment ?? []).map((row) => {
      const old = row.sourceAccountId
      if (typeof old !== 'string') return row
      return { ...row, sourceAccountId: sourceIdByOldId.get(old) ?? old }
    })
    console.log(
      `♻️  GlRoleAssignment: ${await restore(after, 'GlRoleAssignment', assignments)} rows`
    )
  } finally {
    after.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('❌ reconcile-local-accounting failed:', error)
  process.exitCode = 1
})
