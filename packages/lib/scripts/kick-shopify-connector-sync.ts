// packages/lib/scripts/kick-shopify-connector-sync.ts
// Dev helper: resume the Shopify data connector and enqueue a manual sync, then wait for
// the run to finish. Used to prove the phase-0a projection lands real column values.
//
// Usage: CONNECTOR_ID=… ORG_ID=… npx tsx scripts/kick-shopify-connector-sync.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { enqueueConnectorSync } from '../src/data-connectors/data-connector-queue'

const CONNECTOR_ID = process.env.CONNECTOR_ID ?? 't0e33r78tehnzcrbkqur0tcc'
const ORG_ID = process.env.ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const before = await db.query.DataConnector.findFirst({
    where: (c, { eq: e }) => e(c.id, CONNECTOR_ID),
  })
  if (!before) throw new Error(`No connector ${CONNECTOR_ID}`)
  console.log(
    `connector "${before.name}" status=${before.status} lastSyncedAt=${before.lastSyncedAt}`
  )

  if (before.status !== 'live') {
    await db
      .update(schema.DataConnector)
      .set({ status: 'live', updatedAt: new Date() })
      .where(eq(schema.DataConnector.id, CONNECTOR_ID))
    console.log(`resumed: ${before.status} -> live`)
  }

  await enqueueConnectorSync({
    connectorId: CONNECTOR_ID,
    organizationId: ORG_ID,
    trigger: 'manual',
  })
  console.log('enqueued manual sync; waiting for the run to settle…\n')

  // Poll the run table rather than guessing a fixed sleep.
  let lastSeen = ''
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    const runs = await db.query.DataConnectorRun.findMany({
      where: (r, { eq: e }) => e(r.dataConnectorId, CONNECTOR_ID),
      orderBy: (r, { desc }) => [desc(r.startedAt)],
      limit: 1,
    })
    const run = runs[0] as any
    const streams = await db.query.DataConnectorStream.findMany({
      where: (s, { eq: e }) => e(s.dataConnectorId, CONNECTOR_ID),
    })
    const line =
      `run=${run?.status ?? 'none'} ` +
      streams
        .map((s: any) => `${s.streamKey}:${s.state?.phase ?? '?'}/${s.state?.recordsSeen ?? 0}`)
        .join(' ')
    if (line !== lastSeen) {
      console.log(`  [${i * 5}s] ${line}`)
      lastSeen = line
    }
    if (run && ['success', 'failed', 'partial', 'cancelled'].includes(run.status)) {
      console.log(`\nrun finished: ${run.status}`)
      if (run.error) console.log(`  error: ${JSON.stringify(run.error).slice(0, 500)}`)
      break
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
