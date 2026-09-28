// packages/lib/scripts/drive-backfill-14a.ts
//
// Drives a full backfill of one connector on an ISOLATED database and Redis, running only the
// data-connector job handlers in-process (no other worker, no schedulers), and prints the 14a
// timing and per-mapping counters when the chain finishes. plans/mrp/14-batched-connector-sink.md §3.
//
//   DATABASE_URL=postgresql://…/auxx-14a REDIS_PORT=6380 \
//     npx dotenv -- npx tsx packages/lib/scripts/drive-backfill-14a.ts <organizationId> <connectorId>

import { database, schema } from '@auxx/database'
import { getConnectionOptions } from '@auxx/redis'
import { Queue, Worker } from 'bullmq'
import { and, eq, gt, sql } from 'drizzle-orm'
import type {
  BackfillSliceJobData,
  DataConnectorSyncJobData,
} from '../src/data-connectors/data-connector-queue'
import {
  runBackfillSlice,
  SLICE_LOCK_DURATION_MS,
  startConnectorSync,
} from '../src/data-connectors/slice-orchestrator'
import { Queues } from '../src/jobs/queues'

const [organizationId, connectorId] = process.argv.slice(2)
if (!organizationId || !connectorId) {
  console.error('usage: drive-backfill-14a.ts <organizationId> <connectorId>')
  process.exit(1)
}
if (!/auxx-14a/.test(process.env.DATABASE_URL ?? '') || process.env.REDIS_PORT !== '6380') {
  console.error('refusing: DATABASE_URL must name auxx-14a and REDIS_PORT must be 6380')
  process.exit(1)
}

const T = schema.DataConnectorRun
const ms = (n: number) => `${(n / 1000).toFixed(1)}s`

async function main() {
  const connector = await database.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, connectorId!),
      eq(schema.DataConnector.organizationId, organizationId!)
    ),
  })
  if (!connector) throw new Error('connector not found on this database')
  const streams = await database.query.DataConnectorStream.findMany({
    where: eq(schema.DataConnectorStream.dataConnectorId, connectorId!),
  })
  const mappings = await database
    .select({
      id: schema.DataConnectorMapping.id,
      mode: schema.DataConnectorMapping.targetMode,
      slug: schema.EntityDefinition.apiSlug,
    })
    .from(schema.DataConnectorMapping)
    .leftJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.DataConnectorMapping.entityDefinitionId)
    )
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
    )
    .where(eq(schema.DataConnectorStream.dataConnectorId, connectorId!))
  const mappingName = new Map(mappings.map((m) => [m.id, `${m.slug ?? '?'} (${m.mode})`]))

  // Force every stream fresh: resync pending on all, stream state back to backfill with no cursor.
  const streamIds = streams.filter((s) => s.enabled).map((s) => s.id)
  await database
    .update(schema.DataConnector)
    .set({
      resyncPending: {
        level: 'rebackfill',
        reasons: ['14a-measure'],
        streamIds,
        at: new Date().toISOString(),
        itemCount: 0,
      } as never,
      status: 'live',
    })
    .where(eq(schema.DataConnector.id, connectorId!))
  await database.execute(
    sql`UPDATE "DataConnectorStream" SET state = (COALESCE(state, '{}'::jsonb) - 'backfillCursor') || '{"phase":"backfill"}'::jsonb WHERE "dataConnectorId" = ${connectorId}`
  )
  console.log(`streams reset: ${streams.map((s) => s.streamKey).join(', ')}`)

  const connection = getConnectionOptions()
  const queue = new Queue(Queues.dataConnectorQueue, { connection })
  await queue.drain(true)
  const never = new AbortController()
  const worker = new Worker(
    Queues.dataConnectorQueue,
    async (job) => {
      if (job.name === 'data-connector-backfill-slice') {
        await runBackfillSlice(database, job.data as BackfillSliceJobData, never.signal)
        return
      }
      if (job.name === 'data-connector-sync') {
        const data = job.data as DataConnectorSyncJobData
        await startConnectorSync(database, data.organizationId, data.connectorId, {
          trigger: data.trigger,
          sampleLimit: data.sampleLimit,
          reimport: data.reimport,
          continueRunId: data.continueRunId,
          retryClaim: data.retryClaim,
        })
        return
      }
      console.log(`ignored job ${job.name}`)
    },
    { connection, concurrency: 2, lockDuration: SLICE_LOCK_DURATION_MS }
  )
  worker.on('failed', (job, error) =>
    console.log(`job failed ${job?.name} ${job?.id}: ${error.message}`)
  )

  const startedAt = new Date()
  const wall = Date.now()
  await startConnectorSync(database, organizationId!, connectorId!, { trigger: 'manual' })
  console.log('backfill started')

  for (;;) {
    await new Promise((r) => setTimeout(r, 60_000))
    const runs = await database
      .select()
      .from(T)
      .where(and(eq(T.dataConnectorId, connectorId!), gt(T.startedAt, startedAt)))
      .orderBy(T.startedAt)
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'prioritized',
      'waiting-children'
    )
    const pending = Object.values(counts).reduce((a, b) => a + b, 0)
    const row = await database.query.DataConnector.findFirst({
      where: eq(schema.DataConnector.id, connectorId!),
    })
    const open = runs.filter((r) => !r.finishedAt).length
    const tot = runs.reduce(
      (a, r) => {
        const timing = (r.progress as { timing?: { fetchMs?: number; sinkMs?: number } } | null)
          ?.timing
        a.duration += r.durationMs ?? 0
        a.fetch += timing?.fetchMs ?? 0
        a.sink += timing?.sinkMs ?? 0
        a.fetched += r.fetched
        a.created += r.created
        a.updated += r.updated
        a.skipped += r.skipped
        a.failed += r.failed
        a.pages += r.pagesProcessed ?? 0
        return a
      },
      {
        duration: 0,
        fetch: 0,
        sink: 0,
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        pages: 0,
      }
    )
    console.log(
      `[${ms(Date.now() - wall)}] runs=${runs.length} open=${open} jobs=${pending} status=${row?.status} ` +
        `pages=${tot.pages} fetched=${tot.fetched} created=${tot.created} updated=${tot.updated} skipped=${tot.skipped} failed=${tot.failed} ` +
        `run=${ms(tot.duration)} fetch=${ms(tot.fetch)} sink=${ms(tot.sink)}`
    )
    const done = runs.length > 0 && open === 0 && pending === 0 && row?.status !== 'syncing'
    if (!done) continue

    console.log('\n=== runs ===')
    for (const r of runs) {
      const timing = (r.progress as { timing?: { fetchMs?: number; sinkMs?: number } } | null)
        ?.timing
      console.log(
        `${r.id} ${r.status} pages=${r.pagesProcessed} fetched=${r.fetched} created=${r.created} updated=${r.updated} skipped=${r.skipped} failed=${r.failed} ` +
          `run=${ms(r.durationMs ?? 0)} fetch=${ms(timing?.fetchMs ?? 0)} sink=${ms(timing?.sinkMs ?? 0)}`
      )
    }
    const byMapping = new Map<
      string,
      { created: number; updated: number; skipped: number; failed: number }
    >()
    for (const r of runs) {
      const bm =
        (r.progress as { byMapping?: Record<string, Record<string, number>> } | null)?.byMapping ??
        {}
      for (const [id, c] of Object.entries(bm)) {
        const e = byMapping.get(id) ?? { created: 0, updated: 0, skipped: 0, failed: 0 }
        e.created += c.created ?? 0
        e.updated += c.updated ?? 0
        e.skipped += c.skipped ?? 0
        e.failed += c.failed ?? 0
        byMapping.set(id, e)
      }
    }
    console.log('\n=== by mapping ===')
    console.log('mapping | created | updated | skipped | failed')
    for (const [id, c] of [...byMapping].sort(
      (a, b) => b[1].created + b[1].updated - (a[1].created + a[1].updated)
    )) {
      console.log(
        `${mappingName.get(id) ?? id} | ${c.created} | ${c.updated} | ${c.skipped} | ${c.failed}`
      )
    }
    console.log(
      `\n=== total === wall=${ms(Date.now() - wall)} run=${ms(tot.duration)} fetch=${ms(tot.fetch)} sink=${ms(tot.sink)} ` +
        `pages=${tot.pages} fetched=${tot.fetched} created=${tot.created} updated=${tot.updated} skipped=${tot.skipped} failed=${tot.failed}`
    )
    const sample = runs.flatMap((r) => ((r.errorSample as unknown[]) ?? []).slice(0, 3))
    if (sample.length) console.log('\nerror samples:', JSON.stringify(sample.slice(0, 6), null, 1))
    await worker.close()
    await queue.close()
    process.exit(0)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
