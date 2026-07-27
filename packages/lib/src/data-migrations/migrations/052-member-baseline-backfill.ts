// packages/lib/src/data-migrations/migrations/052-member-baseline-backfill.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { type Area, type Level, parseAreaLevels } from '../../permissions/capabilities/registry'
import {
  fanOutCapabilityChange,
  resolveProfileAudience,
  type SystemProfileSlug,
  systemProfileSeed,
} from '../../permissions/profiles'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-052')

/** The two system profiles plan 22 §2.2/§2.3 seed a baseline `levels` map for. */
const BASELINE_SLUGS: Extract<SystemProfileSlug, 'member' | 'field_tech'>[] = [
  'member',
  'field_tech',
]

/**
 * The plan 22 §3 backfill merge rule: an existing explicit level always wins; the
 * baseline only fills areas the stored grant left unset. Exported as a small pure
 * function so the rule itself — not the surrounding DB plumbing — is what a
 * reviewer (or a future test) checks.
 *
 * Source the baseline from `object spread` (right-hand side wins), so an org's
 * pre-existing row — e.g. one migration 041 already narrowed with a deliberate
 * `records: Read` downward adjustment — keeps that value; only areas the row
 * never mentioned pick up the seed's default.
 */
export function mergeBaselineUnderExisting(
  baseline: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>
): Partial<Record<Area, Level>> {
  return { ...baseline, ...existing }
}

/** Whether two sparse level maps hold the same set of area → level pairs. */
function levelsEqual(a: Partial<Record<Area, Level>>, b: Partial<Record<Area, Level>>): boolean {
  const aKeys = Object.keys(a) as Area[]
  const bKeys = Object.keys(b) as Area[]
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => a[key] === b[key])
}

/**
 * Backfill `MEMBER_BASELINE_LEVELS` / `FIELD_TECH_BASELINE_LEVELS` onto every
 * existing org's `member` / `field_tech` `PermissionGrant` row (plan 22 §3's
 * backfill row).
 *
 * Why this is needed in addition to migration 049: `ensureSystemProfiles` only
 * ever writes the seeded `levels` map for a `PermissionProfile` row it JUST
 * inserted (via `.returning()` on a conflict-ignoring insert) — see
 * `system-profiles.ts`'s "never resurrect a baseline an admin cleared"
 * rationale. Every org that already had `member`/`field_tech` rows before this
 * deploy (i.e. every existing dev org, seeded by migration 049 itself) is
 * therefore untouched by that write. Left alone, `ROLE_DEFAULTS.USER`'s strip to
 * the all-`None` floor (plan 22 §2 decision 1) would compose every one of those
 * orgs' members to `None` on every area until an admin manually re-authored the
 * profile. This migration closes that gap by merging the baseline directly onto
 * the already-seeded grant row.
 *
 * Merge rule (plan 22 §3): **existing explicit level wins, baseline fills only
 * unset areas** — see {@link mergeBaselineUnderExisting}. This preserves any
 * deliberate downward adjustment migration 041 already copied onto an org's
 * Member row from the old `role:org_member` policy.
 *
 * Sources the baseline from the seed itself (`systemProfileSeed(slug)!.levels`),
 * never a local copy, so this migration can never drift from
 * `MEMBER_BASELINE_LEVELS` / `FIELD_TECH_BASELINE_LEVELS` in `seat-policy.ts`.
 *
 * Cache invalidation is required, not optional: `compute-user-capabilities.ts`
 * skips the `PermissionGrant` query entirely while the org's cached
 * `hasPermissionGrants` flag reads `false` (one-day TTL) — without busting it
 * here, a freshly-backfilled org's members would keep composing to `None` until
 * that flag happens to expire. `fanOutCapabilityChange('permission-grant.changed', …)`
 * is the exact call `grant-service.ts`'s `emitGrantChanged` makes for a
 * `profile`-grantee write: it busts the org's `hasPermissionGrants` key AND every
 * affected holder's `userCapabilities` blob (`invalidation-graph.ts`), plus
 * dehydration and a realtime nudge — no new invalidation machinery invented.
 *
 * Idempotent and re-runnable: every write is derived purely from the seed plus
 * the row's current stored content, so a second run recomputes the same merged
 * map and writes (and invalidates) nothing when it already matches.
 */
export const migration052MemberBaselineBackfill: DataMigrationDef = {
  id: '052-member-baseline-backfill',
  description:
    "Backfill MEMBER_BASELINE_LEVELS / FIELD_TECH_BASELINE_LEVELS onto existing orgs' member/field_tech PermissionGrant rows",
  async run(db: Database): Promise<void> {
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    if (orgs.length === 0) {
      logger.info('No organizations to backfill')
      return
    }

    let inserted = 0
    let updated = 0
    let skippedMissingProfile = 0

    for (const org of orgs) {
      const organizationId = org.id

      for (const slug of BASELINE_SLUGS) {
        const baseline = systemProfileSeed(slug)?.levels
        // Both baseline seeds are non-null in code today (plan 22 §2.2/§2.3) —
        // guarded anyway rather than assumed, since a future seed edit that drops
        // `levels` should make this a no-op, not a crash.
        if (!baseline) continue

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
          // Migration 049 seeds this row for every org; a missing row here means
          // 049 hasn't run yet (or failed) for this org — log and move on rather
          // than throw, so one unusual org doesn't halt the whole backfill.
          logger.warn('System profile missing for org, skipping baseline backfill', {
            organizationId,
            slug,
          })
          skippedMissingProfile += 1
          continue
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

        let changed = false

        if (!grant) {
          // `id` omitted — the column's `$defaultFn(createId)` mints it.
          await db.insert(schema.PermissionGrant).values({
            organizationId,
            granteeType: 'profile',
            granteeId: profile.id,
            levels: baseline,
          })
          inserted += 1
          changed = true
        } else {
          const existing = parseAreaLevels(grant.levels)
          const merged = mergeBaselineUnderExisting(baseline, existing)
          if (!levelsEqual(merged, existing)) {
            await db
              .update(schema.PermissionGrant)
              .set({ levels: merged, updatedAt: new Date() })
              .where(eq(schema.PermissionGrant.id, grant.id))
            updated += 1
            changed = true
          }
        }

        if (!changed) continue

        // Mirrors grant-service.ts's `emitGrantChanged` 'profile' branch — this IS
        // a profile-grantee `PermissionGrant.levels` write, so it gets the exact
        // same invalidation: hasPermissionGrants (org) + userCapabilities (every
        // affected holder, including null-bound ones via `resolveProfileAudience`)
        // + dehydration + a realtime nudge.
        const audience = await resolveProfileAudience({
          organizationId,
          profileId: profile.id,
          slug,
          isSystem: true,
        })
        await fanOutCapabilityChange('permission-grant.changed', organizationId, audience)
      }
    }

    logger.info('Backfilled member/field_tech permission grant baselines', {
      orgs: orgs.length,
      inserted,
      updated,
      skippedMissingProfile,
    })
  },
}
