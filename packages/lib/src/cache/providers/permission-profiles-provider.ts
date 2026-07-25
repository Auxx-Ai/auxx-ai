// packages/lib/src/cache/providers/permission-profiles-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { projectPermissionProfile } from '../../permissions/profiles/profile-projection'
import type { CachedPermissionProfile } from '../../permissions/profiles/types'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Every `PermissionProfile` row for an org (system + custom), coerced to the
 * JSON-serializable cache shape.
 *
 * Exists so `computeUserCapabilities` can resolve `profileId → base/ceiling` —
 * and the `systemProfileFor` null-binding fallback — without a query, keeping the
 * composer at its existing THREE DB round-trips (§8.1). Small and rarely
 * mutated: one row per profile, a handful per org.
 */
export const permissionProfilesProvider: CacheProvider<CachedPermissionProfile[]> = {
  async compute(orgId, db) {
    const rows = await db
      .select({
        id: schema.PermissionProfile.id,
        slug: schema.PermissionProfile.slug,
        name: schema.PermissionProfile.name,
        description: schema.PermissionProfile.description,
        icon: schema.PermissionProfile.icon,
        seat: schema.PermissionProfile.seat,
        appliesTo: schema.PermissionProfile.appliesTo,
        baseLevel: schema.PermissionProfile.baseLevel,
        ceiling: schema.PermissionProfile.ceiling,
        agentPolicy: schema.PermissionProfile.agentPolicy,
        isSystem: schema.PermissionProfile.isSystem,
        updatedAt: schema.PermissionProfile.updatedAt,
      })
      .from(schema.PermissionProfile)
      .where(eq(schema.PermissionProfile.organizationId, orgId))

    return rows.map(projectPermissionProfile)
  },
}
