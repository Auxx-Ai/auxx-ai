// packages/lib/scripts/seed-bank-feed-provider.ts
//
// Upsert the platform `ConnectionDefinition` rows from `PLATFORM_PROVIDER_DEFS`, so the
// new `stripeFinancialConnections` definition (HANDOFF slot 3A) exists locally.
//
// `ensurePlatformProviders` only runs at seed time, so a def added mid-development
// reaches an existing database through this script, the `reseedConnectionProvidersJob`
// maintenance job, or a reseed data migration.
//
//   npx dotenv -- npx tsx packages/lib/scripts/seed-bank-feed-provider.ts

import { database } from '@auxx/database'
import { ensurePlatformProviders } from '../src/connections/providers'

async function main() {
  await ensurePlatformProviders(database)
  const rows = await database.query.ConnectionDefinition.findMany({
    where: (cd, { eq }) => eq(cd.providerKey, 'stripeFinancialConnections'),
  })
  console.log(JSON.stringify(rows, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
