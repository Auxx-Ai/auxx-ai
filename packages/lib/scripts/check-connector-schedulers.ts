// packages/lib/scripts/check-connector-schedulers.ts
// List the BullMQ job schedulers currently registered on the data-connector queue.
// Used to verify `removeConnectorScheduler` actually ran when a connector was
// disconnected (plans/money/tasks/44 §7.2 step 6) — a schedule that keeps ticking
// for an uninstalled app is the bug the old delete-loop existed to fix.
//
//   npx dotenv -- npx tsx packages/lib/scripts/check-connector-schedulers.ts

import { getQueue, Queues } from '../src/jobs/queues'

async function main() {
  const queue = getQueue(Queues.dataConnectorQueue)
  const schedulers = await queue.getJobSchedulers(0, 100, true)

  console.log(`registered job schedulers on ${Queues.dataConnectorQueue}: ${schedulers.length}`)
  for (const s of schedulers) {
    console.log(
      `  ${s.key}  pattern=${s.pattern ?? '-'}  tz=${s.tz ?? '-'}  next=${
        s.next ? new Date(s.next).toISOString() : '-'
      }`
    )
  }

  await queue.close()
  process.exit(0)
}

void main()
