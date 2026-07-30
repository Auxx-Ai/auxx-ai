// packages/lib/scripts/repair-member-baseline.ts
//
// Repair a system profile's seeded baseline `PermissionGrant` row.
//
// WHY THIS EXISTS. `ensureSystemProfiles` writes `levels` only for a profile row it
// JUST inserted ("never resurrect a baseline an admin cleared", `system-profiles.ts`),
// so a Member grant that loses keys after creation is never healed by anything. Found
// 2026-07-29: `DemoOrg1`'s Member profile stored 5 keys where every other org stored
// the full 15, so its members had no signatures, dashboards, files, agents, comments,
// workflows, datasets, KB or dispatch access and could not create a signature.
//
// ROOT CAUSE IS UNCONFIRMED. `savePermissionProfile` writes `levels` wholesale, so an
// editor draft that loaded incompletely and then saved would produce exactly this
// shape. That is a live bug if it exists, and repairing the row destroys the evidence
// — so this script SNAPSHOTS every row it touches to a JSON file first, always, even
// in `--dry-run`. Keep those files until the cause is known.
//
// MODES.
//   default   fill gaps only — an existing explicit level always wins. Matches
//             migration 056's merge rule, so a deliberately narrowed area survives and
//             extra keys the seed does not carry (e.g. a granted `settings`) are kept.
//   --reset   replace with the seed map EXACTLY. Drops extra keys and overwrites
//             narrowed ones. Use only when you know the row is garbage.
//
// USAGE (dry run is the default — nothing is written without `--apply`):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/repair-member-baseline.ts --org DemoOrg1
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/repair-member-baseline.ts --org DemoOrg1 --apply
//
//   # audit every org, change nothing:
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/repair-member-baseline.ts
//
// FLAGS
//   --org <name|id>   restrict to one organization (name match is exact)
//   --slug <slug>     which system profile — `member` (default) or `field_tech`
//   --reset           replace rather than fill gaps
//   --apply           actually write; without it this only reports
//
// Idempotent: a second run finds nothing to do.

import { mkdirSync, writeFileSync } from 'node:fs'
import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { type Area, type Level, parseAreaLevels } from '../src/permissions/capabilities/registry'
import {
  fanOutCapabilityChange,
  resolveProfileAudience,
  systemProfileSeed,
} from '../src/permissions/profiles'

type AreaLevels = Partial<Record<Area, Level>>

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const ORG = flag('org')
const SLUG = (flag('slug') ?? 'member') as 'member' | 'field_tech'
const RESET = process.argv.includes('--reset')
const APPLY = process.argv.includes('--apply')

/** Areas present in `a` but missing from `b`, and areas whose level differs. */
function diff(seed: AreaLevels, current: AreaLevels) {
  const missing = (Object.keys(seed) as Area[]).filter((a) => current[a] === undefined)
  const differing = (Object.keys(seed) as Area[]).filter(
    (a) => current[a] !== undefined && current[a] !== seed[a]
  )
  const extra = (Object.keys(current) as Area[]).filter((a) => seed[a] === undefined)
  return { missing, differing, extra }
}

async function main() {
  const seed = systemProfileSeed(SLUG)?.levels
  if (!seed) {
    console.error(`No seed levels for system profile '${SLUG}'. Nothing to compare against.`)
    process.exit(1)
  }

  const profiles = await db
    .select({
      id: schema.PermissionProfile.id,
      organizationId: schema.PermissionProfile.organizationId,
      orgName: schema.Organization.name,
    })
    .from(schema.PermissionProfile)
    .innerJoin(
      schema.Organization,
      eq(schema.Organization.id, schema.PermissionProfile.organizationId)
    )
    .where(
      and(eq(schema.PermissionProfile.slug, SLUG), eq(schema.PermissionProfile.isSystem, true))
    )

  const targets = ORG
    ? profiles.filter((p) => p.orgName === ORG || p.organizationId === ORG)
    : profiles

  if (targets.length === 0) {
    console.error(ORG ? `No '${SLUG}' profile found for org '${ORG}'.` : `No '${SLUG}' profiles.`)
    process.exit(1)
  }

  console.log(
    `Seed for '${SLUG}' has ${Object.keys(seed).length} areas. ` +
      `Checking ${targets.length} profile(s). Mode: ${RESET ? 'reset' : 'fill gaps'}. ` +
      `${APPLY ? 'APPLYING' : 'DRY RUN — pass --apply to write'}.\n`
  )

  const snapshots: unknown[] = []
  let repaired = 0
  let clean = 0
  let missingGrant = 0

  for (const profile of targets) {
    const [grant] = await db
      .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
      .from(schema.PermissionGrant)
      .where(
        and(
          eq(schema.PermissionGrant.organizationId, profile.organizationId),
          eq(schema.PermissionGrant.granteeType, 'profile'),
          eq(schema.PermissionGrant.granteeId, profile.id)
        )
      )
      .limit(1)

    if (!grant) {
      // A silent profile is NOT necessarily broken — it composes through
      // `ROLE_DEFAULTS`. Report it and move on rather than inventing a row.
      console.log(
        `  ${profile.orgName}: no grant row at all — skipped (composes via ROLE_DEFAULTS)`
      )
      missingGrant += 1
      continue
    }

    const current = parseAreaLevels(grant.levels)
    const { missing, differing, extra } = diff(seed, current)
    const needsWork = RESET
      ? missing.length + differing.length + extra.length > 0
      : missing.length > 0

    if (!needsWork) {
      clean += 1
      continue
    }

    snapshots.push({
      organizationId: profile.organizationId,
      orgName: profile.orgName,
      profileId: profile.id,
      slug: SLUG,
      grantId: grant.id,
      levelsBefore: current,
    })

    const merged: AreaLevels = RESET ? { ...seed } : { ...seed, ...current }

    console.log(`  ${profile.orgName} (${profile.organizationId})`)
    console.log(`    before:  ${JSON.stringify(current)}`)
    console.log(`    after:   ${JSON.stringify(merged)}`)
    if (missing.length) console.log(`    restoring: ${missing.join(', ')}`)
    if (differing.length) {
      const detail = differing.map((a) => `${a} ${current[a]}→${seed[a]}`).join(', ')
      console.log(`    ${RESET ? 'overwriting' : 'KEEPING (use --reset to change)'}: ${detail}`)
    }
    if (extra.length) {
      console.log(`    ${RESET ? 'dropping' : 'keeping'} non-seed keys: ${extra.join(', ')}`)
    }

    if (APPLY) {
      await db
        .update(schema.PermissionGrant)
        .set({ levels: merged, updatedAt: new Date() })
        .where(eq(schema.PermissionGrant.id, grant.id))

      // Same invalidation `grant-service.ts`'s `emitGrantChanged` performs for a
      // profile-grantee write, and the one migration 056 uses. Without it the fix is
      // invisible for the full `userCapabilities` TTL (ONE_DAY).
      const audience = await resolveProfileAudience({
        organizationId: profile.organizationId,
        profileId: profile.id,
        slug: SLUG,
        isSystem: true,
      })
      await fanOutCapabilityChange('permission-grant.changed', profile.organizationId, audience)
      console.log('    ✓ written + capabilities invalidated')
    }
    repaired += 1
  }

  if (snapshots.length > 0) {
    // `.tmp/` is gitignored (`.gitignore:13`). Deliberately NOT the repo root: an
    // untracked JSON there is exactly what rides into someone else's commit, and this
    // worktree is shared — see HANDOFF's "`git add <your paths>` is not enough".
    mkdirSync('.tmp', { recursive: true })
    const path = `.tmp/member-baseline-snapshot-${SLUG}.json`
    writeFileSync(path, JSON.stringify(snapshots, null, 2))
    console.log(`\nSnapshot of ${snapshots.length} pre-change row(s) written to ${path}`)
    console.log('Keep it — it is the only evidence of how the row got this way.')
  }

  console.log(
    `\n${APPLY ? 'Repaired' : 'Would repair'}: ${repaired}. ` +
      `Already correct: ${clean}. No grant row: ${missingGrant}.`
  )
  if (repaired > 0 && !APPLY) console.log('Re-run with --apply to write.')
  process.exit(0)
}

void main()
