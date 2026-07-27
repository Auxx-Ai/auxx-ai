// packages/lib/src/data-migrations/migrations/049-seed-permission-profiles.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../cache'
import { ensureSystemProfiles } from '../../permissions/profiles'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-041')

/** The deleted `PermissionGrant` policy tier (doc 19 §0.8). */
const LEGACY_POLICY_GRANTEE_TYPE = 'role'
const LEGACY_POLICY_GRANTEE_ID = 'org_member'

/**
 * Seed the system permission profiles for every EXISTING org and move the
 * `role:org_member` capability baseline onto each org's `member` profile
 * (plan 19 §5.2 / §9 step 2).
 *
 * Why this must run promptly after deploy: the composer no longer reads the
 * `role:org_member` `PermissionGrant` tier at all — the bound profile IS the
 * baseline. Until this runs, an org that *customized* its member baseline composes
 * from `ROLE_DEFAULTS` instead (an org that never customized is unaffected either
 * way, because an unset area falls through to the same code default). Plan §9 step
 * 2 explicitly accepts that window rather than shipping a dual-read shim: *"no
 * dual-read shim, because there are effectively no production users to protect."*
 * This migration is the only thing standing between a customized baseline and the
 * code defaults.
 *
 * Idempotent and re-runnable (`rerun-data-migration.ts` exists, so assume it will
 * be):
 *  - `ensureSystemProfiles` upserts with `onConflictDoNothing` on
 *    `(organizationId, slug)`, so an org whose system rows were edited keeps them;
 *  - the copy is skipped when the `member` profile already has a grant row, so a
 *    re-run never stomps an admin's later edit;
 *  - the source row delete is the last step per org, so a re-run after a partial
 *    failure simply finds nothing left to copy.
 *
 * `PermissionGrant.granteeId` has NO FK, so nothing about this cascades — the copy
 * and the delete are both explicit.
 */
export const migration049SeedPermissionProfiles: DataMigrationDef = {
  id: '049-seed-permission-profiles',
  description:
    'Seed system permission profiles per org and move the role:org_member capability baseline onto the member profile',
  async run(db: Database): Promise<void> {
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    if (orgs.length === 0) {
      logger.info('No organizations to seed')
      return
    }

    let seeded = 0
    let copied = 0
    let deleted = 0

    for (const org of orgs) {
      const organizationId = org.id

      // 1. System profiles (idempotent).
      await ensureSystemProfiles(organizationId, db)
      seeded += 1

      // 2. The org's `member` profile is the new home of the baseline.
      const [memberProfile] = await db
        .select({ id: schema.PermissionProfile.id })
        .from(schema.PermissionProfile)
        .where(
          and(
            eq(schema.PermissionProfile.organizationId, organizationId),
            eq(schema.PermissionProfile.slug, 'member')
          )
        )
        .limit(1)

      if (!memberProfile) {
        // ensureSystemProfiles just ran, so this is a hard inconsistency.
        throw new Error(`member permission profile missing after seeding for org ${organizationId}`)
      }

      const [legacy] = await db
        .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
        .from(schema.PermissionGrant)
        .where(
          and(
            eq(schema.PermissionGrant.organizationId, organizationId),
            eq(schema.PermissionGrant.granteeType, LEGACY_POLICY_GRANTEE_TYPE),
            eq(schema.PermissionGrant.granteeId, LEGACY_POLICY_GRANTEE_ID)
          )
        )
        .limit(1)

      if (!legacy) continue

      // Never stomp a profile row an admin already authored on a re-run.
      const [existingProfileGrant] = await db
        .select({ id: schema.PermissionGrant.id })
        .from(schema.PermissionGrant)
        .where(
          and(
            eq(schema.PermissionGrant.organizationId, organizationId),
            eq(schema.PermissionGrant.granteeType, 'profile'),
            eq(schema.PermissionGrant.granteeId, memberProfile.id)
          )
        )
        .limit(1)

      if (!existingProfileGrant) {
        // Raw `levels` are copied verbatim — including any explicit `Level.None`,
        // which stays load-bearing on a profile grantee (it is the base tier).
        await db.insert(schema.PermissionGrant).values({
          // `id` omitted — the column's `$defaultFn(createId)` mints it.
          organizationId,
          granteeType: 'profile',
          granteeId: memberProfile.id,
          levels: legacy.levels,
        })
        copied += 1
      }

      // 3. Drop the source row last — a re-run then finds nothing to copy.
      await db.delete(schema.PermissionGrant).where(eq(schema.PermissionGrant.id, legacy.id))
      deleted += 1

      // Every member of this org composed from the old tier; bust their blobs.
      await onCacheEvent('permission-profile.changed', {
        orgId: organizationId,
        broadcastUserKeys: true,
      })
    }

    logger.info('Seeded permission profiles and moved member baselines', {
      orgs: orgs.length,
      seeded,
      baselinesCopied: copied,
      legacyRowsDeleted: deleted,
    })
  },
}
