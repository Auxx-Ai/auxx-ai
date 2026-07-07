// packages/lib/scripts/run-pending-data-migrations.ts
//
// One-off: apply all pending ledgered data migrations against the configured
// database. Run with env loaded, e.g.:
//   npx dotenv -- npx tsx packages/lib/scripts/run-pending-data-migrations.ts

import { closePools, database } from '@auxx/database'
import { runPendingDataMigrations } from '../src/data-migrations'

async function main() {
  const summary = await runPendingDataMigrations(database)
  // eslint-disable-next-line no-console
  console.log('Data migration run summary:', JSON.stringify(summary, null, 2))
  await closePools()
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Data migration run failed:', err)
  await closePools()
  process.exit(1)
})
