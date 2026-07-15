// packages/lib/scripts/backfill-client-notification-sequences.ts
//
// One-off backfill: seed the 5 client-notification sequences (plans/dispatch/
// 19-client-notifications.md §4.6 — visit reminders, en-route, job follow-up, invoice
// reminders, opt-in visit follow-up) for every EXISTING organization. New orgs get these from
// `OrganizationSeeder.seedClientNotificationSequences` automatically; this script covers orgs
// created before this plan shipped. Idempotent on `(organizationId, templateKey)` — safe to
// re-run (a second pass is a no-op for every org that already has all 5).
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-client-notification-sequences.ts

import { database as db, schema } from '@auxx/database'
import { seedClientNotificationSequences } from '../src/sequences'

async function main() {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
  console.log(`Found ${orgs.length} organizations`)

  let succeeded = 0
  let failed = 0

  for (const org of orgs) {
    try {
      await seedClientNotificationSequences(db, org.id)
      succeeded++
    } catch (error) {
      failed++
      console.error(`Failed to seed sequences for org ${org.id}:`, error)
    }
  }

  console.log(`Done. Seeded (or already up to date) ${succeeded} organizations, ${failed} failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
