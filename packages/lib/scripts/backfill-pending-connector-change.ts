// packages/lib/scripts/backfill-pending-connector-change.ts
// Dev helper: the "Backfill now" banner action — reset the streams a mapping edit
// marked `resyncPending` to a fresh backfill and re-crawl.
//
// Usage: CONNECTOR_ID=… ORG_ID=… npx tsx scripts/backfill-pending-connector-change.ts

import { database as db } from '@auxx/database'
import { backfillPendingChange } from '../src/data-connectors/slice-orchestrator'

const CONNECTOR_ID = process.env.CONNECTOR_ID ?? 't0e33r78tehnzcrbkqur0tcc'
const ORG_ID = process.env.ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const before = await db.query.DataConnector.findFirst({
    where: (c, { eq }) => eq(c.id, CONNECTOR_ID),
  })
  console.log(`resyncPending before: ${JSON.stringify((before as any)?.resyncPending ?? null)}`)

  await backfillPendingChange(db, ORG_ID, CONNECTOR_ID)
  console.log('backfill requested; waiting…\n')

  let last = ''
  for (let i = 0; i < 48; i++) {
    await sleep(5000)
    const runs = await db.query.DataConnectorRun.findMany({
      where: (r, { eq }) => eq(r.dataConnectorId, CONNECTOR_ID),
      orderBy: (r, { desc }) => [desc(r.startedAt)],
      limit: 1,
    })
    const run = runs[0] as any
    const line = `run=${run?.status} fetched=${run?.fetched} updated=${run?.updated} skipped=${run?.skipped} failed=${run?.failed}`
    if (line !== last) {
      console.log(`  [${i * 5}s] ${line}`)
      last = line
    }
    if (run && ['completed', 'failed', 'partial', 'cancelled'].includes(run.status)) break
  }

  const after = await db.query.DataConnector.findFirst({
    where: (c, { eq }) => eq(c.id, CONNECTOR_ID),
  })
  console.log(`\nresyncPending after: ${JSON.stringify((after as any)?.resyncPending ?? null)}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
