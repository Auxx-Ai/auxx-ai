// packages/lib/src/permissions/profiles/profile-resolution.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { systemProfileFor, systemProfileSeed } from './system-profiles'
import type { CachedPermissionProfile, ProfileCeiling } from './types'

const logger = createScopedLogger('permission-profiles')

/**
 * The two halves of a resolved human base profile that composition consumes:
 * the fallback rung for unset areas and the profile's per-area clamp.
 * `profileId` is `null` when nothing resolved (runtime fallback — §5.2).
 */
export interface ResolvedBaseProfile {
  profileId: string | null
  slug: string
  baseLevel: CachedPermissionProfile['baseLevel']
  /** Unauthored (plan 20 §2.a.3) — `null` for every profile in practice. */
  ceiling: ProfileCeiling | null
}

/**
 * Resolve the ONE human base profile for a member (§1.3), from the org's cached
 * profile list — zero extra queries.
 *
 *  - An explicit `permissionProfileId` wins, but only if it exists in THIS org's
 *    projection. A foreign/dangling id is refused (never silently applied) and
 *    falls back to the system template, matching the FK's `set null` intent.
 *  - A null binding resolves via {@link systemProfileFor}. Nothing is ever
 *    stamped, so a system-profile edit reaches null-bound holders immediately.
 *  - **Runtime fallback (§5.2):** if the system row is absent (an org that
 *    predates seeding, or a seeding failure), resolve from the code seed —
 *    `ROLE_DEFAULTS` via a null `baseLevel`, or `Full` for owner/admin — and
 *    `logger.warn`. Never fail closed (that would lock an org out) and never
 *    fail open past the seat ceiling (which clamps last regardless).
 */
export function resolveBaseProfile(input: {
  organizationId: string
  userId: string
  role: OrganizationRole
  seatType: SeatType
  permissionProfileId: string | null | undefined
  profiles: readonly CachedPermissionProfile[]
}): ResolvedBaseProfile {
  const { organizationId, userId, role, seatType, permissionProfileId, profiles } = input

  if (permissionProfileId) {
    const bound = profiles.find((p) => p.id === permissionProfileId)
    if (bound) {
      return {
        profileId: bound.id,
        slug: bound.slug,
        baseLevel: bound.baseLevel,
        ceiling: bound.ceiling,
      }
    }
    logger.warn('Bound permission profile not found in org projection — using system template', {
      organizationId,
      userId,
      permissionProfileId,
    })
  }

  const slug = systemProfileFor(role, seatType)
  const system = profiles.find((p) => p.slug === slug)
  if (system) {
    return {
      profileId: system.id,
      slug: system.slug,
      baseLevel: system.baseLevel,
      ceiling: system.ceiling,
    }
  }

  // Runtime fallback: no row seeded. Mirror the code seed so behavior matches a
  // freshly seeded org exactly, and stay loud about it.
  logger.warn('System permission profile missing — falling back to ROLE_DEFAULTS', {
    organizationId,
    userId,
    slug,
  })
  return {
    profileId: null,
    slug,
    baseLevel: systemProfileSeed(slug)?.baseLevel ?? null,
    ceiling: null,
  }
}
