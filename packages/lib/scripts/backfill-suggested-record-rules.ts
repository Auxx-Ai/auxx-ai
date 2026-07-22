// packages/lib/scripts/backfill-suggested-record-rules.ts
//
// One-off backfill: seed the 3 starter suggested record rules (plans/signals/
// 06-follow-ups-build.md decision 8 — unsubscribe-flag, hard-bounce-review,
// hot-contact-follow-up) for every EXISTING organization. New orgs get these from
// `OrganizationSeeder.seedSuggestedRecordRules` automatically; this script covers orgs created
// before this plan shipped. Idempotent on `(organizationId, templateKey)` — safe to re-run (a
// second pass is a no-op for every org that already has all 3).
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-suggested-record-rules.ts

import { database as db, schema } from '@auxx/database'
import { seedSuggestedRecordRules } from '../src/record-rules'

async function main() {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
  console.log(`Found ${orgs.length} organizations`)

  let succeeded = 0
  let failed = 0

  for (const org of orgs) {
    try {
      await seedSuggestedRecordRules(db, org.id)
      succeeded++
    } catch (error) {
      failed++
      console.error(`Failed to seed suggested record rules for org ${org.id}:`, error)
    }
  }

  console.log(`Done. Seeded (or already up to date) ${succeeded} organizations, ${failed} failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
