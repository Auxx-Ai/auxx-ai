// packages/lib/scripts/kick-outlook-sync.ts
// Dev unblock: the Outlook initial backfill stalls at MESSAGES_IMPORT_PENDING because
// Outlook resolves to webhook mode and the polling scanner skips webhook-mode integrations.
// Flip the integration to polling so the scanner drives the pipeline, and kick the first
// import job immediately so we can watch it drain.
// Run: npx dotenv -- node --conditions source --import tsx/esm packages/lib/scripts/kick-outlook-sync.ts <integrationId>
import { closePools, database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { getQueue, Queues } from '../src/jobs/queues'

const integrationId = process.argv[2]
if (!integrationId) {
  // eslint-disable-next-line no-console
  console.error('usage: kick-outlook-sync.ts <integrationId>')
  process.exit(1)
}

const [integ] = await db
  .select({
    id: schema.Integration.id,
    organizationId: schema.Integration.organizationId,
    provider: schema.Integration.provider,
    syncStage: schema.Integration.syncStage,
    syncMode: schema.Integration.syncMode,
  })
  .from(schema.Integration)
  .where(eq(schema.Integration.id, integrationId))
  .limit(1)

if (!integ) {
  // eslint-disable-next-line no-console
  console.error('integration not found:', integrationId)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log('before:', integ)

await db
  .update(schema.Integration)
  .set({ syncMode: 'polling', updatedAt: new Date() })
  .where(eq(schema.Integration.id, integrationId))

// Kick the import job now (mirrors what the scanner enqueues for MESSAGES_IMPORT_PENDING).
const queue = getQueue(Queues.pollingSyncQueue)
await queue.add(
  'messagesImportJob',
  { integrationId, organizationId: integ.organizationId, provider: integ.provider },
  {
    jobId: `poll-import-${integrationId}-${Date.now()}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  }
)

// eslint-disable-next-line no-console
console.log('✓ flipped syncMode -> polling and enqueued messagesImportJob')
await closePools()
process.exit(0)
