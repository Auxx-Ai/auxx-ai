// packages/lib/scripts/backfill-ai-category-tags.ts
//
// One-off backfill: seed the five starter mail categories — Sales · Support · Billing ·
// Newsletter · Notification, under a "Mail Categories" parent
// (plans/mail-filter/05-mail-classification-plan.md §2.4) — for every EXISTING organization.
// New orgs get them from `OrganizationSeeder.seedTags` automatically; this script covers orgs
// created before mail classification shipped. Idempotent by tag title: a second pass creates
// nothing.
//
// ⚠️ **It ADOPTS legacy system starters.** `seedTags` historically created Billing/Sales/
// Support as SYSTEM tags, which `rejectIfSystemTag` freezes — description included — and that
// description IS the classifier's instruction. So a pre-existing tag of one of those names
// carrying `is_system_tag = true` is converted in place: flag cleared, starter description
// written, marked eligible, re-parented. The tag ID is preserved, so every filter and
// suggestion referencing it keeps resolving.
//
// A tag of the same name that the USER created (`is_system_tag = false`) is left entirely
// alone — a title collision is not consent.
//
// ⚠️ **This enables no classification anywhere.** It only makes labels available. Nothing is
// classified until an inbox is opted in, which is a separate per-inbox switch that this
// script must never write — a migration must not start billing an org for inference.
//
// ⚠️ **Run entity migration 074 first** (`074-tag-ai-classify`, via the pending
// data-migration runner). Without the `tag_ai_classify` CustomField an org is skipped with a
// warning rather than half-seeded.
//
// Each org's `customFields`/`resources` cache keys are recomputed before its seed so the
// create path sees the field 074 just added, even if this runs in a different process from
// the migration.
//
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-ai-category-tags.ts

import { database as db, schema } from '@auxx/database'
import { getOrgCache } from '../src/cache'
import { seedAiCategoryTags } from '../src/seed/ai-category-tags'
import { SystemUserService } from '../src/users/system-user-service'

async function main() {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
  console.log(`Found ${orgs.length} organizations`)

  let succeeded = 0
  let failed = 0
  let createdTotal = 0

  for (const org of orgs) {
    try {
      await getOrgCache().invalidateAndRecompute(org.id, ['customFields', 'resources'])
      // No human author on a backfill — the org's own system user owns the rows.
      const userId = await SystemUserService.getSystemUserForActions(org.id)
      const { created, skipped } = await seedAiCategoryTags(db, org.id, userId)
      createdTotal += created.length
      console.log(
        `${org.id}: created [${created.join(', ') || '—'}], already present [${
          skipped.join(', ') || '—'
        }]`
      )
      succeeded++
    } catch (error) {
      failed++
      console.error(`Failed to seed AI category tags for org ${org.id}:`, error)
    }
  }

  console.log(
    `Done. ${succeeded} organizations processed (${createdTotal} tags created), ${failed} failed.`
  )
  process.exit(failed > 0 ? 1 : 0)
}

void main()
