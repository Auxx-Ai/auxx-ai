// packages/lib/scripts/backfill-suggested-mail-filters.ts
//
// One-off backfill: seed the starter suggested mail filters
// (plans/mail-filter/02-mail-filters-plan.md §9 phase 5 — automated-notifications,
// bulk-newsletters, billing-mail, key-domain) for every EXISTING organization. New orgs get
// these from `OrganizationSeeder.seedSuggestedMailFilters` automatically; this script covers
// orgs created before phase 5 shipped. Idempotent on `(organizationId, templateKey)` — safe
// to re-run (a second pass is a no-op for every org that already has them). Orgs with no
// shared inbox, or without the tag a template needs, are skipped with a warning rather than
// failing. `seedSuggestedMailFilters` busts the org's `mailFilters` cache key itself when it
// actually inserts something, so this script needs no invalidation pass of its own — do not
// add one here, or the two drift.
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-suggested-mail-filters.ts

import { database as db, schema } from '@auxx/database'
import { seedSuggestedMailFilters } from '../src/mail-filters'

async function main() {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
  console.log(`Found ${orgs.length} organizations`)

  let succeeded = 0
  let failed = 0

  for (const org of orgs) {
    try {
      await seedSuggestedMailFilters(db, org.id)
      succeeded++
    } catch (error) {
      failed++
      console.error(`Failed to seed suggested mail filters for org ${org.id}:`, error)
    }
  }

  console.log(`Done. Seeded (or already up to date) ${succeeded} organizations, ${failed} failed.`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
