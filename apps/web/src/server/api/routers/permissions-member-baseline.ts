// apps/web/src/server/api/routers/permissions-member-baseline.ts

import { getCachedPermissionProfileBySlug } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import type { GranteeGrant, GrantGranteeType } from '@auxx/lib/permissions'

/**
 * TODO(plan-19-step-7): **interim** bridge between the shipped Member-baseline tab
 * and the permission-profile substrate. Delete this module when step 7 replaces
 * `member-baseline-tab.tsx` with the Member-profile editor (doc 19 §7).
 *
 * ## Why it exists
 *
 * Step 2 deleted the `role:org_member` **`PermissionGrant`** tier: the bound
 * profile IS the area-level baseline (§0.8), and `composeUserCapabilities` reads
 * only `granteeType:'profile'` / `'group'` / `'user'`. The shipped tab still
 * writes `role:org_member`, so without this bridge an admin edits the org-wide
 * member baseline, sees it save, and gets **zero** effect.
 *
 * Rather than plumb profile ids into the client, both directions are translated
 * here at the tRPC boundary — one choke point, one deletion:
 *
 *  - **write** — {@link resolveGrantGrantee} rewrites `role:org_member` to
 *    `profile:<member profile id>` before it reaches `setGranteeLevels` /
 *    `clearGranteeLevels`.
 *  - **read** — {@link bridgeMemberBaselineGrants} presents the `member` profile's
 *    stored levels back as `role:org_member`, which is where
 *    `use-permission-grants.ts` looks for `baseline`.
 *
 * This is semantically exact, not a hack: §0.8 makes the Member profile the
 * baseline by definition, so the baseline editor pointing at it is the same thing.
 *
 * ## Scope — `PermissionGrant` ONLY
 *
 * `role:org_member` is used on two tables and only one is dead:
 *
 * | Table | `role:org_member` | This module |
 * |---|---|---|
 * | `PermissionGrant` (sparse per-area `levels`) | **dead** after step 2 | redirected here |
 * | `ResourceAccess` (per-def / per-instance rows) | **live** — it is the def/workspace-baseline marker (`compute-user-capabilities.ts` keeps it in the grantee union) | **never touched** |
 *
 * `use-def-baselines.ts`, `use-def-access.ts`, `use-instance-share.ts` and
 * `def-baseline-rows.tsx` all write `ResourceAccess` through the
 * `resourceAccess` router and must keep sending `role:org_member`. Redirecting
 * those would re-privatize defs org-wide (doc 03 first-touch persistence, doc 11
 * workspace-baseline preservation).
 */

/** The `PermissionProfile.slug` that *is* the org-wide member baseline (§0.8/§5.1). */
export const MEMBER_PROFILE_SLUG = 'member'

/**
 * The legacy `PermissionGrant` baseline grantee the shipped tab still writes.
 * Mirrors `MEMBER_BASELINE_GRANTEE_ID` in
 * `~/components/permissions/hooks/use-permission-grants` (a `'use client'` module,
 * hence the duplicated literal rather than a shared import).
 */
export const LEGACY_BASELINE_GRANTEE = { granteeType: 'role', granteeId: 'org_member' } as const

/** One `PermissionGrant` grantee address. */
export interface GrantGrantee {
  granteeType: GrantGranteeType
  granteeId: string
}

/** Whether this grantee is the dead `role:org_member` `PermissionGrant` tier. */
export function isLegacyBaselineGrantee(grantee: GrantGrantee): boolean {
  return (
    grantee.granteeType === LEGACY_BASELINE_GRANTEE.granteeType &&
    grantee.granteeId === LEGACY_BASELINE_GRANTEE.granteeId
  )
}

/**
 * Resolve the `PermissionGrant` grantee a write should actually land on.
 *
 * `role:org_member` is redirected onto the org's `member` system profile; every
 * other grantee (`group`, `user`, and a future explicit `profile`) passes through
 * untouched.
 *
 * `Level.None` survives the redirect: `grant-service`'s `granteeKeepsNoneLevels`
 * returns `true` for `profile` grantees precisely because the profile supplies the
 * composition base, so an explicit "No Access" is stored rather than stripped.
 *
 * @throws NotFoundError when the org has no `member` profile. Seeding is
 *   idempotent (`ensureSystemProfiles`) and data migration 041 ran it for every
 *   existing org, so this is a hard inconsistency — failing loudly is required:
 *   writing the legacy row instead would "succeed" while composing to nothing,
 *   which is the exact regression this bridge fixes.
 */
export async function resolveGrantGrantee(
  organizationId: string,
  grantee: GrantGrantee
): Promise<GrantGrantee> {
  if (!isLegacyBaselineGrantee(grantee)) return grantee

  const profile = await getCachedPermissionProfileBySlug(organizationId, MEMBER_PROFILE_SLUG)
  if (!profile) {
    throw new NotFoundError(
      'This organization has no Member permission profile, so the member baseline cannot be ' +
        'saved. System profiles are seeded per organization — contact support to re-seed.'
    )
  }

  return { granteeType: 'profile', granteeId: profile.id }
}

/**
 * Present the `member` profile's stored area levels back to the client under the
 * `role:org_member` address the Member-baseline tab reads — reads must match
 * writes, or a successful save shows stale/empty values on reload.
 *
 * The profile row is *renamed*, not duplicated, so the same levels never appear
 * twice under two identities. Any residual pre-migration `role:org_member` row is
 * dropped: the profile is authoritative (migration 041 copies then deletes it).
 * Group and user rows, and every other profile's rows, pass through unchanged.
 *
 * An unseeded org has nothing to bridge — the list is returned as-is and the tab
 * falls back to `ROLE_DEFAULTS`, matching what `resolveBaseProfile` composes in
 * that same state.
 */
export async function bridgeMemberBaselineGrants(
  organizationId: string,
  grants: GranteeGrant[]
): Promise<GranteeGrant[]> {
  const profile = await getCachedPermissionProfileBySlug(organizationId, MEMBER_PROFILE_SLUG)
  if (!profile) return grants

  const memberProfileRow = grants.find(
    (g) => g.granteeType === 'profile' && g.granteeId === profile.id
  )

  const bridged = grants.filter(
    (g) =>
      !isLegacyBaselineGrantee(g) && !(g.granteeType === 'profile' && g.granteeId === profile.id)
  )

  if (memberProfileRow) {
    bridged.push({
      granteeType: LEGACY_BASELINE_GRANTEE.granteeType,
      granteeId: LEGACY_BASELINE_GRANTEE.granteeId,
      levels: memberProfileRow.levels,
    })
  }

  return bridged
}
