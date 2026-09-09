// packages/lib/scripts/run-entity-migration.ts
//
// Run ONE entity migration for every org (or one org) straight from source,
// outside the data-migrations ledger. For a migration that is already recorded
// `applied` but whose code was corrected afterwards: the ledger will not re-run
// an applied migration, and every entity migration is idempotent, so running
// it again by hand is the sanctioned way to land the correction locally.
//
// It does not touch the `DataMigration` ledger. Production gets the corrected
// code through the ledger on its first run, so this is a dev-only tool.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/run-entity-migration.ts --id 136-refunds-and-tax-lines
//
//   ... --id 136-refunds-and-tax-lines --org <organizationId>

import { database } from '@auxx/database'
import { ALL_ENTITY_MIGRATIONS, runEntityMigrationForAllOrgs } from '../src/seed/entity-migrations'

const argv = process.argv.slice(2)

function flag(name: string): string | null {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
}

const ID = flag('--id')
const ORG = flag('--org')

async function main(): Promise<void> {
  if (!ID) {
    console.error('--id <migration id> is required. Known ids:')
    for (const m of ALL_ENTITY_MIGRATIONS) console.error(`  ${m.id}`)
    process.exitCode = 1
    return
  }
  const migration = ALL_ENTITY_MIGRATIONS.find((m) => m.id === ID)
  if (!migration) {
    console.error(`No entity migration with id ${ID}`)
    process.exitCode = 1
    return
  }

  if (ORG) {
    const result = await migration.up(database, ORG)
    console.log(JSON.stringify({ organizationId: ORG, ...result }, null, 1))
    return
  }

  // Logs one line per org that changed and throws an aggregate if any org failed.
  await runEntityMigrationForAllOrgs(database, migration)
  console.log(`${ID}: ran for every org`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
