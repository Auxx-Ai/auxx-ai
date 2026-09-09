// packages/lib/src/seed/entity-migrations/migrations/138-accountant-permissions.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../../cache'
import { Area, type Level, parseAreaLevels } from '../../../permissions/capabilities/registry'
import {
  ensureSystemProfiles,
  fanOutCapabilityChange,
  resolveProfileAudience,
  systemProfileSeed,
} from '../../../permissions/profiles'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:138')

/**
 * Migration 138: reach the `bookkeeper` system permission profile from
 * `plans/accounting/tasks/12-accountant-permissions.md` §4.2 into every
 * existing org (step 1), and open `Area.tasks` / `Area.calls` on the
 * `member` and `field_tech` baseline grants that predate those two areas
 * (step 2, task 12 §10).
 *
 * ## Step 1: seed `bookkeeper`
 *
 * `ensureSystemProfiles` is idempotent (`onConflictDoNothing` on
 * `(organizationId, slug)`) and inserts every seed the org is short of, so on
 * an org that predates §4.2 this is what actually creates the `bookkeeper`
 * `PermissionProfile` row and its `PermissionGrant`. A new org already gets
 * both through the org-creation call to `ensureSystemProfiles`; this is the
 * same backfill, same shape and same reason as migration 125 step 7 for
 * `accountant` and migration 053 for the agent presets.
 *
 * `PermissionProfile`/`PermissionGrant` are not `EntityInstance`-backed, so
 * this migration creates no `EntityDefinition` and no `CustomField` row and
 * contributes no counter to the result, same as 125 step 7, and for the same
 * reason.
 *
 * 🛑 **A pre-existing `accountant` row is deliberately NOT narrowed.**
 * `ensureSystemProfiles` writes `levels` only for a profile row it JUST
 * inserted (`system-profiles.ts`'s `.returning()` on the conflict-ignoring
 * insert), so an org that already has `accountant` keeps its existing
 * `{ledger, records, files}` grant untouched by this migration, the §4.2
 * reshape (dropping `Area.records`) changes the SEED for new orgs, not
 * existing rows. There is no safe automatic narrowing that can distinguish an
 * admin's deliberate `records: Read` edit from the old seed's, because the two
 * are byte-identical (plan §6, §9.1). `packages/lib/scripts/sync-system-
 * profiles.ts` is the explicit, one-org, dev-only version of that reset.
 *
 * ## Step 2: open tasks/calls on the member and field_tech baselines
 *
 * `Area.tasks` and `Area.calls` are new areas
 * (`permissions/capabilities/registry.ts`, task 12 §10). `MEMBER_BASELINE_LEVELS`
 * now carries `tasks: Full` and `calls: Full`, and `FIELD_TECH_BASELINE_LEVELS`
 * carries `tasks: Full` (`calls` is absent from `WORKER_AREAS`, so writing it
 * to the field_tech grant would be a lie in the data — same reasoning
 * migration 061 gives for leaving `field_tech` untouched on `Area.inboxes`).
 * Those maps are only the SEED for a profile row `ensureSystemProfiles`
 * inserts for the FIRST time; every existing org's `member` and `field_tech`
 * grant rows were written before these areas existed, so without this step
 * they compose `tasks`/`calls` to `None` and every member and field tech
 * loses both surfaces the moment something starts reading the area.
 *
 * The merge is fill-gaps, same rule as 061: `{ ...additions, ...existing }`,
 * so an existing explicit level always wins. An admin who already narrowed
 * (or widened) `Area.tasks` or `Area.calls` on a `member` or `field_tech` row
 * keeps that; this step only fills in the areas that are entirely absent from
 * the stored `levels` map.
 *
 * Idempotent: `ensureSystemProfiles` inserts with `onConflictDoNothing` (step
 * 1) and the step 2 merge keeps any existing explicit level, so a re-run
 * writes nothing. Re-running against a single org (this migration is already
 * recorded as applied on the local DB) is done with
 * `packages/lib/scripts/run-entity-migration.ts --id 138-accountant-permissions --org <id>`.
 */
export const migration138AccountantPermissions: EntityMigration = {
  id: '138-accountant-permissions',
  description:
    'Backfills the bookkeeper system permission profile into every existing org ' +
    '(plans/accounting/tasks/12-accountant-permissions.md §4.2), and opens Area.tasks / ' +
    'Area.calls on the member and field_tech baseline grants that predate those areas. ' +
    "Leaves a pre-existing accountant row's grants untouched, see the file header for why.",

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    await seedBookkeeperProfile(db, organizationId)
    await backfillTasksAndCallsBaselines(db, organizationId)

    return {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: false,
    }
  },
}

/** Step 1: see the file header. */
async function seedBookkeeperProfile(db: Database, organizationId: string): Promise<void> {
  await ensureSystemProfiles(organizationId, db)
  await onCacheEvent('permission-profile.changed', { orgId: organizationId })
}

/** The areas step 2 opens on the `member` grant row. */
const MEMBER_NEW_AREAS: Area[] = [Area.tasks, Area.calls]

/**
 * The areas step 2 opens on the `field_tech` grant row. `Area.calls` is
 * excluded on purpose: it is absent from `WORKER_AREAS`, so `SEAT_CEILINGS`
 * clamps it to `None` for a worker seat regardless of what the profile says,
 * same reasoning as 061's `field_tech`/`Area.inboxes` exclusion.
 */
const FIELD_TECH_NEW_AREAS: Area[] = [Area.tasks]

/**
 * The addition to merge onto an existing grant row, read from the SEED rather
 * than hard-coded.
 *
 * Exported so the merge rule — not the DB plumbing around it — is what a test
 * checks. `Level.None` is **0**, so membership is decided by an explicit
 * `!== undefined`: a truthiness test would silently drop a future seed that
 * deliberately CLOSES one of these areas, turning "closed on purpose" into
 * "never mentioned", which composes differently. Same shape as 061's
 * `baselineAdditions`, generalized to take the area list as an argument since
 * this migration merges onto two different profiles with two different area
 * sets.
 */
export function baselineAdditions(
  seed: Partial<Record<Area, Level>> | null | undefined,
  areas: Area[]
): Partial<Record<Area, Level>> {
  return areas.reduce<Partial<Record<Area, Level>>>((acc, area) => {
    const level = seed?.[area]
    if (level !== undefined) acc[area] = level
    return acc
  }, {})
}

/**
 * Plan 22 §3's merge rule (same as 061): an existing explicit level always
 * wins. The spread order is the rule — `{ ...additions, ...existing }` — so
 * an admin who has already narrowed `Area.tasks` or `Area.calls` keeps their
 * choice, and a second run is a no-op rather than a reset.
 */
export function mergeBaseline(
  additions: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>
): Partial<Record<Area, Level>> {
  return { ...additions, ...existing }
}

/** True when the merge left every added area exactly where it already was. */
export function isNoopMerge(
  merged: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>,
  areas: Area[]
): boolean {
  return areas.every((area) => merged[area] === existing[area])
}

/**
 * Merge the profile's `levels` grant row for one system profile slug on this
 * org, filling in only the areas listed in `areas` that the stored row does
 * not already mention explicitly. Skips (warns, does not throw) when the
 * profile or its grant row is missing — a missing profile means this org
 * predates `ensureSystemProfiles` seeding that slug, which step 1 above (or an
 * earlier run of it) is responsible for, not this helper.
 */
async function mergeProfileBaseline(
  db: Database,
  organizationId: string,
  slug: 'member' | 'field_tech',
  areas: Area[]
): Promise<void> {
  const additions = baselineAdditions(systemProfileSeed(slug)?.levels, areas)

  if (Object.keys(additions).length === 0) {
    // Not a throw: an empty seed means the registry decided these areas ship
    // closed for this profile, and a migration must not out-vote the registry.
    logger.warn(`${slug} baseline seed carries none of the new areas — nothing to backfill`, {
      organizationId,
      slug,
      areas,
    })
    return
  }

  const [profile] = await db
    .select({ id: schema.PermissionProfile.id })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.organizationId, organizationId),
        eq(schema.PermissionProfile.slug, slug),
        eq(schema.PermissionProfile.isSystem, true)
      )
    )
    .limit(1)

  if (!profile) {
    logger.warn(`${slug} permission profile missing for org, skipping baseline merge`, {
      organizationId,
      slug,
    })
    return
  }

  const [grant] = await db
    .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, profile.id)
      )
    )
    .limit(1)

  if (!grant) {
    logger.warn(`${slug} permission grant missing for org, skipping baseline merge`, {
      organizationId,
      slug,
    })
    return
  }

  const existing = parseAreaLevels(grant.levels)
  const merged = mergeBaseline(additions, existing)
  if (isNoopMerge(merged, existing, areas)) return

  await db
    .update(schema.PermissionGrant)
    .set({ levels: merged, updatedAt: new Date() })
    .where(eq(schema.PermissionGrant.id, grant.id))

  // Same invalidation `grant-service.ts`'s `emitGrantChanged` performs for a
  // profile-grantee write: `hasPermissionGrants` (org) + `userCapabilities`
  // for every holder + dehydration + a realtime nudge. Without it the holders
  // keep serving a capability blob that has no `tasks`/`calls` keys until the
  // ONE_DAY TTL expires.
  const audience = await resolveProfileAudience({
    organizationId,
    profileId: profile.id,
    slug,
    isSystem: true,
  })
  await fanOutCapabilityChange('permission-grant.changed', organizationId, audience)

  logger.info(`Backfilled ${slug} baseline for tasks/calls`, {
    organizationId,
    slug,
    additions,
  })
}

/** Step 2: see the file header. */
async function backfillTasksAndCallsBaselines(db: Database, organizationId: string): Promise<void> {
  await mergeProfileBaseline(db, organizationId, 'member', MEMBER_NEW_AREAS)
  await mergeProfileBaseline(db, organizationId, 'field_tech', FIELD_TECH_NEW_AREAS)
}
