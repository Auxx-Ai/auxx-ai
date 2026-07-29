// packages/lib/src/data-migrations/migrations/061-inboxes-member-baseline-backfill.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { Area, type Level, parseAreaLevels } from '../../permissions/capabilities/registry'
import {
  fanOutCapabilityChange,
  resolveProfileAudience,
  systemProfileSeed,
} from '../../permissions/profiles'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-061')

/** The areas this backfill opens. One today; the shape carries a future second. */
const NEW_AREAS: Area[] = [Area.inboxes]

/**
 * The addition to merge onto an existing member grant, read from the SEED rather
 * than hard-coded.
 *
 * Exported so the merge rule — not the DB plumbing around it — is what a test
 * checks. `Level.None` is **0**, so membership is decided by an explicit
 * `!== undefined`: a truthiness test would silently drop a future seed that
 * deliberately CLOSES one of these areas, turning "closed on purpose" into
 * "never mentioned", which composes differently.
 */
export function baselineAdditions(
  seed: Partial<Record<Area, Level>> | null | undefined
): Partial<Record<Area, Level>> {
  return NEW_AREAS.reduce<Partial<Record<Area, Level>>>((acc, area) => {
    const level = seed?.[area]
    if (level !== undefined) acc[area] = level
    return acc
  }, {})
}

/**
 * Plan 22 §3's merge rule: an existing explicit level always wins. The spread
 * order is the rule — `{ ...additions, ...existing }` — so an admin who has
 * already narrowed `Area.inboxes` keeps their choice, and a second run is a
 * no-op rather than a reset.
 */
export function mergeInboxesBaseline(
  additions: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>
): Partial<Record<Area, Level>> {
  return { ...additions, ...existing }
}

/** True when the merge left every new area exactly where it already was. */
export function isNoopMerge(
  merged: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>
): boolean {
  return NEW_AREAS.every((area) => merged[area] === existing[area])
}

/**
 * Merge `inboxes: Read` onto every existing org's seeded `member`
 * `PermissionGrant` row (plan 40 §7).
 *
 * **Why this is not optional.** Every existing org's member grant row was
 * written by migration 052, before `Area.inboxes` existed, and
 * `ensureSystemProfiles` only seeds `levels` on a row it JUST inserted ("never
 * resurrect a baseline an admin cleared"). So without this backfill every
 * pre-existing org's members compose `Area.inboxes → None` — and the moment
 * phase 2 switches the mail floor to read the area level, they lose ALL shared
 * mail. That is the single loudest possible regression, which is why the
 * backfill ships in phase 1, where nothing reads the new area yet.
 *
 * `Read` is deliberate and comes from `MEMBER_BASELINE_LEVELS`, not from this
 * file: with the two-rung ladder `Read` IS full working access to org-shared
 * mail (`baselineAtCreate: false` ⇒ the area level is also the absent-row
 * tier), i.e. today's behaviour. `Full` would make every member Manager of
 * every inbox.
 *
 * **`field_tech` is deliberately NOT touched.** `Area.inboxes` is absent from
 * `WORKER_AREAS` (plan 40 §7), so `SEAT_CEILINGS.worker` clamps it to `None`
 * for a worker seat regardless of what the profile says — writing it would be
 * a lie in the data that changes nothing in the composition.
 *
 * Separate from 060 on purpose: that migration reshapes MAIL data for the one
 * org that has a personal mailbox, this one rewrites PERMISSION grants for all
 * of them. Different blast radius, different failure mode, independently
 * re-runnable through `rerun-data-migration.ts`.
 *
 * Idempotent: the merge keeps any existing explicit level, so a second run
 * finds every grant already merged and writes nothing.
 */
export const migration061InboxesMemberBaselineBackfill: DataMigrationDef = {
  id: '061-inboxes-member-baseline-backfill',
  description: 'Open Area.inboxes at the member baseline level for every existing org',
  async run(db: Database): Promise<void> {
    const additions = baselineAdditions(systemProfileSeed('member')?.levels)

    if (Object.keys(additions).length === 0) {
      // Not a throw: an empty seed means the registry decided this area ships
      // closed, and a migration must not out-vote the registry.
      logger.warn('Member baseline seed carries no inboxes level — nothing to backfill')
      return
    }

    const profiles = await db
      .select({
        id: schema.PermissionProfile.id,
        organizationId: schema.PermissionProfile.organizationId,
      })
      .from(schema.PermissionProfile)
      .where(
        and(
          eq(schema.PermissionProfile.slug, 'member'),
          eq(schema.PermissionProfile.isSystem, true)
        )
      )

    let updated = 0
    let missingGrant = 0

    for (const profile of profiles) {
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
        // 052 writes this row for every org. A missing one means 052 never ran
        // for this org — log and continue rather than halt the whole batch.
        logger.warn('Member permission grant missing for org, skipping baseline merge', {
          organizationId: profile.organizationId,
        })
        missingGrant += 1
        continue
      }

      const existing = parseAreaLevels(grant.levels)
      const merged = mergeInboxesBaseline(additions, existing)
      if (isNoopMerge(merged, existing)) continue

      await db
        .update(schema.PermissionGrant)
        .set({ levels: merged, updatedAt: new Date() })
        .where(eq(schema.PermissionGrant.id, grant.id))
      updated += 1

      // The same invalidation `grant-service.ts`'s `emitGrantChanged` performs
      // for a profile-grantee write: `hasPermissionGrants` (org) +
      // `userCapabilities` for every holder + dehydration + a realtime nudge.
      // Without it the members keep serving a capability blob that has no
      // `inboxes` keys until the ONE_DAY TTL expires.
      const audience = await resolveProfileAudience({
        organizationId: profile.organizationId,
        profileId: profile.id,
        slug: 'member',
        isSystem: true,
      })
      await fanOutCapabilityChange('permission-grant.changed', profile.organizationId, audience)
    }

    logger.info('Backfilled member baseline for inboxes', {
      profiles: profiles.length,
      updated,
      missingGrant,
      additions,
    })
  },
}
