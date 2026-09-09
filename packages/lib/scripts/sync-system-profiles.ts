// packages/lib/scripts/sync-system-profiles.ts
//
// Resync a local org's system profiles to the current seed.
//
// WHY THIS EXISTS. Nothing heals a system profile's grant row after creation.
// `ensureSystemProfiles` writes `levels` only for a row it JUST inserted (never
// resurrect a baseline an admin cleared, `system-profiles.ts`), so `DemoOrg1`'s
// `accountant` keeps its old `{ledger, records, files}` grant forever, and its
// `bookkeeper` row will not exist at all until something inserts it. Without
// this, testing the accountant-permissions reshape (plan
// `plans/accounting/tasks/12-accountant-permissions.md` §4.2) locally means
// editing `PermissionGrant.levels` by hand in Postgres.
//
// THIS IS DELIBERATE, NOT FORENSIC, unlike `repair-member-baseline.ts`, which
// audits every org by default and fills gaps so an admin's edits survive. This
// script does a destructive, one-org, dev-only reset: it drops keys the current
// seed no longer carries. `--org` therefore has no default, and `--slug`
// defaults to only the two profiles this brief touches.
//
// USAGE (dry run is the default, nothing is written without `--apply`):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/sync-system-profiles.ts --org DemoOrg1
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/sync-system-profiles.ts --org DemoOrg1 --apply
//
// FLAGS
//   --org <name|id>   REQUIRED. Org name match is exact (`DemoOrg1`, not
//                      `demoorg1`). No default, an org-wide run is the one
//                      mistake this script must not make easy.
//   --slug <a,b>      comma-separated system profile slugs. Defaults to
//                      `accountant,bookkeeper`.
//   --apply           actually write; without it this only reports and exits 0.
//
// Idempotent: a second `--apply` run reports zero changes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { database as db, schema } from '@auxx/database'
import { and, eq, or } from 'drizzle-orm'
import { onCacheEvent } from '../src/cache'
import { type Area, type Level, parseAreaLevels } from '../src/permissions/capabilities/registry'
import {
  ensureSystemProfiles,
  fanOutCapabilityChange,
  resolveProfileAudience,
  type SystemProfileSlug,
  systemProfileSeed,
} from '../src/permissions/profiles'

type AreaLevels = Partial<Record<Area, Level>>

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const ORG = flag('org')
const SLUGS = (flag('slug') ?? 'accountant,bookkeeper')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean) as SystemProfileSlug[]
const APPLY = process.argv.includes('--apply')

/** Whether two area-level maps are identical, order-independent. */
function levelsEqual(a: AreaLevels, b: AreaLevels): boolean {
  const aKeys = Object.keys(a) as Area[]
  const bKeys = Object.keys(b) as Area[]
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => a[k] === b[k])
}

async function main() {
  if (!ORG) {
    console.error('--org <name|id> is required. There is no "every org" mode for this script.')
    process.exit(1)
  }

  const [org] = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)
    .where(or(eq(schema.Organization.name, ORG), eq(schema.Organization.id, ORG)))
    .limit(1)

  if (!org) {
    console.error(`No organization found matching '${ORG}' (exact name or id match).`)
    process.exit(1)
  }

  console.log(
    `Org: ${org.name} (${org.id}). Slugs: ${SLUGS.join(', ')}. ` +
      `${APPLY ? 'APPLYING' : 'DRY RUN, pass --apply to write'}.\n`
  )

  // Step 1: idempotent insert of any system profile row the org predates.
  // This is what creates `bookkeeper` (and its grant row) on an org seeded
  // before it existed. Never touches a pre-existing row. Gated on --apply
  // because a dry run must write nothing; without --apply a missing row is
  // reported below as "would be inserted".
  if (APPLY) await ensureSystemProfiles(org.id, db)

  const snapshots: unknown[] = []
  let changed = 0
  let clean = 0
  let skipped = 0
  const changedProfiles: { profileId: string; slug: string }[] = []

  for (const slug of SLUGS) {
    const seed = systemProfileSeed(slug)
    if (!seed) {
      console.log(`  ${slug}: no such system profile seed, skipped`)
      skipped += 1
      continue
    }
    if (!seed.levels) {
      console.log(`  ${slug}: seed has no grant levels (baseLevel/agentPolicy driven), skipped`)
      skipped += 1
      continue
    }

    const [profile] = await db
      .select({ id: schema.PermissionProfile.id })
      .from(schema.PermissionProfile)
      .where(
        and(
          eq(schema.PermissionProfile.organizationId, org.id),
          eq(schema.PermissionProfile.slug, slug),
          eq(schema.PermissionProfile.isSystem, true)
        )
      )
      .limit(1)

    if (!profile) {
      if (APPLY) {
        console.log(`  ${slug}: no PermissionProfile row for this org, skipped`)
        skipped += 1
      } else {
        console.log(
          `  ${slug}: no PermissionProfile row yet, --apply would insert it from the seed`
        )
        changed += 1
      }
      continue
    }

    const [grant] = await db
      .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
      .from(schema.PermissionGrant)
      .where(
        and(
          eq(schema.PermissionGrant.organizationId, org.id),
          eq(schema.PermissionGrant.granteeType, 'profile'),
          eq(schema.PermissionGrant.granteeId, profile.id)
        )
      )
      .limit(1)

    if (!grant) {
      console.log(`  ${slug}: no PermissionGrant row, skipped`)
      skipped += 1
      continue
    }

    const current = parseAreaLevels(grant.levels)
    const next: AreaLevels = { ...seed.levels }

    if (levelsEqual(current, next)) {
      console.log(`  ${slug}: already matches the seed, clean`)
      clean += 1
      continue
    }

    snapshots.push({
      organizationId: org.id,
      orgName: org.name,
      profileId: profile.id,
      slug,
      grantId: grant.id,
      levelsBefore: current,
    })

    console.log(`  ${slug} (${profile.id})`)
    console.log(`    before:  ${JSON.stringify(current)}`)
    console.log(`    after:   ${JSON.stringify(next)}`)

    if (APPLY) {
      await db
        .update(schema.PermissionGrant)
        .set({ levels: next, updatedAt: new Date() })
        .where(eq(schema.PermissionGrant.id, grant.id))
      console.log('    written')
    }

    changedProfiles.push({ profileId: profile.id, slug })
    changed += 1
  }

  if (snapshots.length > 0) {
    // `.tmp/` is gitignored (`.gitignore:13`). Snapshot before writing, in
    // dry-run too, it is the record of what this run would do or did.
    mkdirSync('.tmp', { recursive: true })
    const path = `.tmp/system-profiles-${org.name}.json`
    writeFileSync(path, JSON.stringify(snapshots, null, 2))
    console.log(`\nSnapshot of ${snapshots.length} pre-change row(s) written to ${path}`)
  }

  if (APPLY && changedProfiles.length > 0) {
    // Two different things changed: step 1 may have inserted a new profile row
    // (`permission-profile.changed`), and the loop above reset grant rows
    // (`permission-grant.changed` per changed profile). Without both the
    // change is invisible for the full `userCapabilities` TTL.
    await onCacheEvent('permission-profile.changed', { orgId: org.id })
    for (const { profileId, slug } of changedProfiles) {
      const audience = await resolveProfileAudience({
        organizationId: org.id,
        profileId,
        slug,
        isSystem: true,
      })
      await fanOutCapabilityChange('permission-grant.changed', org.id, audience)
    }
    console.log('\nCapabilities invalidated.')
  }

  console.log(
    `\n${APPLY ? 'Changed' : 'Would change'}: ${changed}. Already correct: ${clean}. ` +
      `Skipped: ${skipped}.`
  )
  if (changed > 0 && !APPLY) console.log('Re-run with --apply to write.')
  process.exit(0)
}

void main()
