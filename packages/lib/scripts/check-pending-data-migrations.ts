// packages/lib/scripts/check-pending-data-migrations.ts

/**
 * Which data migrations the registry declares that the ledger has not applied.
 *
 * Every entity migration is spread into the same registry by
 * `data-migrations/registry.ts`, so this covers both halves of the shared NNN id
 * space. Three answers, and each means something different:
 *
 * - **pending**: declared and never run. The worker enqueues a run at boot, so
 *   this is normally empty and a non-empty list means the worker has not booted
 *   since the migration landed.
 * - **non-applied**: in the ledger with a status other than `applied`. A failed
 *   migration is recorded and never auto-retried; re-running is deliberate.
 * - **orphan**: in the ledger with no registry entry, i.e. a migration that was
 *   deleted or renamed after it ran.
 *
 * Read-only. Run with `npx dotenv -e ../../.env -- npx tsx scripts/check-pending-data-migrations.ts`.
 */

import { database, schema } from '@auxx/database'
import { ALL_DATA_MIGRATIONS } from '../src/data-migrations'

async function main(): Promise<void> {
  const rows = await database
    .select({ id: schema.DataMigration.id, status: schema.DataMigration.status })
    .from(schema.DataMigration)

  const ledger = new Map(rows.map((row) => [row.id, row.status]))
  const pending = ALL_DATA_MIGRATIONS.filter((m) => !ledger.has(m.id))
  const nonApplied = rows.filter((row) => row.status !== 'applied')
  const orphans = rows.filter((row) => !ALL_DATA_MIGRATIONS.some((m) => m.id === row.id))

  console.log(`registry declares ${ALL_DATA_MIGRATIONS.length}, ledger holds ${rows.length}`)
  console.log(`\npending (never run): ${pending.length}`)
  for (const m of pending) console.log(`    ${m.id}  ${m.description}`)
  console.log(`\nnon-applied ledger rows: ${nonApplied.length}`)
  for (const row of nonApplied) console.log(`    ${row.id}  ${row.status}`)
  console.log(`\norphan ledger rows (no registry entry): ${orphans.length}`)
  for (const row of orphans) console.log(`    ${row.id}`)
}

main().then(() => process.exit(0))
