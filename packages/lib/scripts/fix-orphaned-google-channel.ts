// packages/lib/scripts/fix-orphaned-google-channel.ts
// One-off dev data fix (2026-07-07): an inbox delete orphaned the
// markus@auxx.ai Google channel (InboxIntegration row deleted, Integration
// left enabled), and a stale disabled integration got linked to Shared Inbox
// as default. Relink the live channel, unlink the dead one, and turn off
// calendar sync on the live one (its re-minted credential lacks the calendar
// scope). Delete this script after running.

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { InboxService } from '../src/inboxes/inbox-service'

const ORG_ID = 'abgwpa1l81reht2zmwrcihfu'
const SHARED_INBOX_ID = 'h1exhmxytqri8le6tyqyuj8h'
const LIVE_GOOGLE_INTEGRATION = 'bytr9n3jhuqqkedpz9pp01o2' // markus@auxx.ai, enabled, orphaned
const DEAD_GOOGLE_INTEGRATION = 'nlzjo3s1i19nm4ytchvvz6n5' // support@demo.auxx.ai, disabled since March

async function main() {
  const inboxService = new InboxService(db, ORG_ID)

  // 1. Unlink the disabled integration (it grabbed isDefault on Shared Inbox).
  await inboxService.removeIntegration(`inbox:${SHARED_INBOX_ID}` as any, DEAD_GOOGLE_INTEGRATION)
  console.log('Unlinked dead integration', DEAD_GOOGLE_INTEGRATION)

  // 2. Relink the live Google channel to Shared Inbox as the default sender.
  const link = await inboxService.addIntegrationById(SHARED_INBOX_ID, LIVE_GOOGLE_INTEGRATION, true)
  console.log('Relinked live integration', link)

  // 3. Calendar scope is gone from the re-minted credential — stop the
  //    "Insufficient Permission" spam. Re-granting calendar re-enables.
  const [row] = await db
    .select({ metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, LIVE_GOOGLE_INTEGRATION))
    .limit(1)
  const base =
    row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
  await db
    .update(schema.Integration)
    .set({
      metadata: { ...base, calendarSyncEnabled: false } as any,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, LIVE_GOOGLE_INTEGRATION))
  console.log('calendarSyncEnabled=false on', LIVE_GOOGLE_INTEGRATION)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
