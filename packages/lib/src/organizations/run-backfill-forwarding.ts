// packages/lib/src/organizations/run-backfill-forwarding.ts

import { database as db } from '@auxx/database'
import { backfillAllOrgsForwardingIntegrations } from './backfill-forwarding-integrations'

async function main() {
  console.log('Starting forwarding address integration backfill...')

  const count = await backfillAllOrgsForwardingIntegrations(db)

  console.log(`Done. ${count} organizations backfilled.`)
  process.exit(0)
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
